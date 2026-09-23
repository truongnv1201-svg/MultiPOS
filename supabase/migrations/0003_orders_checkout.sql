-- Migration 03 — Orders + checkout_order (SRS §2.2)
-- Vá: NEW-CONF-03 (rounding chỉ khi cash), NEW-CONF-04 (SUM từ JSONB),
--     INV-ERR-01 (GROUP BY variant), INV-ERR-02 (bỏ service/combo cha),
--     POS-ERR-01/02 (change_amount + recompute subtotal server-side)

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null, -- HD-YYMMDD-XXXX
  branch_id uuid references public.branches(id),
  customer_id uuid references public.customers(id),
  customer_name text not null default 'Khách Lẻ',
  status text not null default 'pending' check (status in ('pending','deposit_order','completed','cancelled','returned')),
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  shipping_fee numeric(12,2) not null default 0,
  cash_rounding numeric(8,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  debt_amount numeric(12,2) not null default 0 check (debt_amount >= 0),
  note text,
  cashier_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  product_variant_id uuid references public.product_variants(id),
  sku text not null,
  name text not null,
  item_type text not null default 'goods' check (item_type in ('goods','area','combo','service')),
  unit text not null default 'cái',
  quantity numeric(14,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  processing_fee numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0,
  dimension_details jsonb, -- [{actual_m2, perimeter_md, grinding_type, processing_fee,...}]
  waste_factor numeric(5,2) default 0,
  material_consumed numeric(14,3),
  returned_indexes integer[] not null default '{}' -- INV-ERR-04: chống hoàn 2 lần 1 tấm
);

-- Trừ kho tập trung, gọi từ checkout_order sau khi khóa đơn
create or replace function public.consume_stock_for_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  -- GROUP BY product_variant_id / product_id trước khi trừ (INV-ERR-01)
  for r in
    select oi.product_id, oi.product_variant_id, sum(coalesce(oi.material_consumed, oi.quantity)) as need
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
      and oi.item_type not in ('service','combo') -- INV-ERR-02
      and oi.product_id is not null
    group by oi.product_id, oi.product_variant_id
  loop
    if r.product_variant_id is not null then
      update public.product_variants set stock_quantity = stock_quantity - r.need
      where id = r.product_variant_id;
      if (select stock_quantity from public.product_variants where id = r.product_variant_id) < 0 then
        raise exception 'Tồn kho biến thể không đủ (INV-ERR-01)';
      end if;
    else
      update public.products set stock_quantity = stock_quantity - r.need
      where id = r.product_id;
      if (select stock_quantity from public.products where id = r.product_id) < 0 then
        raise exception 'Tồn kho không đủ (Invariant #2)';
      end if;
    end if;

    insert into public.stock_movements (reference_code, product_id, quantity, note)
    values ((select order_code from public.orders where id = p_order_id), r.product_id, -r.need, 'Xuất bán checkout_order');
  end loop;

  -- Combo: trừ linh kiện con theo số lượng cha
  for r in
    select ci.child_product_id as product_id, sum(ci.quantity * oi.quantity) as need
    from public.order_items oi
    join public.combo_items ci on ci.combo_product_id = oi.product_id
    where oi.order_id = p_order_id and oi.item_type = 'combo'
    group by ci.child_product_id
  loop
    update public.products set stock_quantity = stock_quantity - r.need where id = r.product_id;
    if (select stock_quantity from public.products where id = r.product_id) < 0 then
      raise exception 'Tồn kho linh kiện combo không đủ (INV-ERR-02)';
    end if;
  end loop;
end; $$;

-- RPC checkout chuẩn SRS §2.2 (server tính lại mọi thứ — Invariant #5)
create or replace function public.checkout_order(
  p_order_id uuid, p_discount numeric, p_payments jsonb, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_payable numeric(12,2) := 0;
  v_total_paid numeric(12,2) := 0;
  v_change numeric(12,2) := 0;
  v_debt numeric(12,2) := 0;
  v_paid_alloc numeric(12,2) := 0;
  v_rounding numeric(8,2) := 0;
  v_denom integer := 500;
  v_code text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status = 'completed' then
    raise exception 'Đơn hàng không tồn tại hoặc đã hoàn tất';
  end if;

  -- POS-ERR-02: tính lại subtotal + processing_fee từ JSONB trước khi SUM
  update public.order_items oi set
    processing_fee = case
      when oi.item_type = 'area' and oi.dimension_details is not null then
        coalesce((select sum((x->>'processing_fee')::numeric) from jsonb_array_elements(oi.dimension_details) x), 0)
      else coalesce(oi.processing_fee, 0) end,
    subtotal = case
      when oi.item_type = 'area' and oi.dimension_details is not null then
        round(coalesce((select sum((x->>'actual_m2')::numeric) from jsonb_array_elements(oi.dimension_details) x), oi.quantity)
          * oi.unit_price
          + coalesce((select sum((x->>'processing_fee')::numeric) from jsonb_array_elements(oi.dimension_details) x), 0)
          - coalesce(oi.discount_amount,0), 2)
      else round(oi.quantity * oi.unit_price + coalesce(oi.processing_fee,0) - coalesce(oi.discount_amount,0), 2) end
  where oi.order_id = p_order_id;

  select coalesce(sum(subtotal),0) into v_payable from public.order_items where order_id = p_order_id;
  select coalesce((value->>'denominator')::int, 500) into v_denom from public.settings where key = 'cash_rounding';

  -- NEW-CONF-03: chỉ làm tròn khi có method='cash'
  if exists (select 1 from jsonb_to_recordset(p_payments) as x("method" text) where x."method" = 'cash') then
    v_rounding := (v_payable - p_discount) % v_denom;
  else
    v_rounding := 0;
  end if;

  select coalesce(sum((x->>'amount')::numeric),0) into v_total_paid from jsonb_array_elements(p_payments) as x;

  -- POS-ERR-01: khách đưa dư → change, cap doanh thu = phải trả
  if v_total_paid > (v_payable - p_discount - v_rounding) then
    v_change := v_total_paid - (v_payable - p_discount - v_rounding);
    v_paid_alloc := v_payable - p_discount - v_rounding;
    v_debt := 0;
  else
    v_paid_alloc := v_total_paid;
    v_debt := round((v_payable - p_discount - v_rounding) - v_total_paid, 2);
  end if;

  update public.orders set status='completed', subtotal=v_payable, discount_amount=p_discount,
    cash_rounding=v_rounding, total_amount=v_payable - p_discount - v_rounding,
    paid_amount=paid_amount + v_paid_alloc, debt_amount=v_debt,
    note=coalesce(p_note, note), updated_at=now()
  where id = p_order_id returning order_code into v_code;

  perform public.consume_stock_for_order(p_order_id);

  -- Ghi nợ khách (Invariant #3: >=0 đã check constraint)
  if v_debt > 0 and v_order.customer_id is not null then
    update public.customers set current_debt = current_debt + v_debt where id = v_order.customer_id;
  end if;

  -- Sổ quỹ chỉ ghi phần mới (FIN-ERR-01): loại debt/points
  insert into public.cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
  select public.generate_order_code('PT'),
    'receipt',
    case when (x->>'method') = 'cash' then 'cash' else 'bank' end,
    'sales', (x->>'amount')::numeric, v_code, 'Checkout ' || v_code
  from jsonb_array_elements(p_payments) x
  where (x->>'method') not in ('debt','points') and (x->>'amount')::numeric > 0;

  return jsonb_build_object('ok', true, 'order_code', v_code, 'change_amount', v_change);
end; $$;
