-- Migration 0087 — Hủy phiếu nhập kho (đảo tồn, MAC, nợ NCC, hoàn tiền).
-- Vấn đề: phiếu nhập đã cộng tồn/đổi MAC/tăng nợ NCC/tạo phiếu chi nhưng KHÔNG có
-- đường lùi khi lập nhầm mặt hàng. Sửa tay tồn kho làm lệch thẻ kho + sổ quỹ + công nợ.
--
-- Hàm đảo ngược hợp đồng của 0086 sync_stock_import:
--   1) Trả tồn theo từng dòng (quantity âm), chặn dưới 0 (hàng đã bán hết) và báo lại.
--   2) Hoàn MAC theo giá net của chính phiếu: new_avg = (stock*avg - qty*net)/new_stock.
--      new_stock = 0 -> giữ avg = net (KHÔNG set 0: trigger trg_init_variant_avg_cost sẽ
--      ghi đè 0 bằng import_price).
--   3) Giảm nợ NCC (clamp >= 0, như cancel_order).
--   4) Hoàn tiền: đọc phiếu chi gốc (reference_order_code = mã phiếu) và tạo PT đối ứng
--      client_ref = 'void:<mã phiếu>' để chống hoàn 2 lần.
--   5) Đánh dấu purchase_orders.status = 'cancelled' (chặn hủy lần 2 -> already_cancelled).
-- Giảm toàn phiếu không lưu cột riêng (purchase_orders không có order_discount_percent):
-- suy ra = discount_amount - tổng giảm dòng trong lines, đúng như 0086 đã ghi.

alter table public.purchase_orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

create or replace function public.void_stock_import(
  p_code text default null,
  p_order_id uuid default null,
  p_client_ref text default null,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_po public.purchase_orders%rowtype;
  l jsonb;
  it jsonb;
  v_sku text;
  v_ref uuid;
  v_pid uuid;
  v_qty numeric;
  v_price numeric;
  v_line_discount numeric;
  v_line_gross numeric;
  v_total_gross numeric;
  v_subtotal numeric;
  v_order_discount numeric;
  v_line_discount_sum numeric;
  v_alloc numeric;
  v_net numeric;
  v_stock numeric;
  v_avg numeric;
  v_new_stock numeric;
  v_new_avg numeric;
  v_pids uuid[];
  v_items jsonb;
  v_products jsonb;
  v_clamped jsonb;
  v_skipped jsonb;
  v_debt numeric;
  v_supplier_debt numeric;
  v_refund numeric;
  v_fund text;
  v_category text;
  v_partner text;
  v_cash jsonb;
  v_reason text;
begin
  if not public.is_manager() then
    raise exception 'Chỉ Admin/Quản lý được hủy phiếu nhập';
  end if;

  if p_order_id is not null then
    select * into v_po from public.purchase_orders where id = p_order_id for update;
  end if;
  if v_po.id is null and nullif(btrim(p_client_ref), '') is not null then
    select * into v_po from public.purchase_orders where client_ref = btrim(p_client_ref) for update;
  end if;
  if v_po.id is null and nullif(btrim(p_code), '') is not null then
    select * into v_po from public.purchase_orders where code = btrim(p_code) for update;
  end if;
  if v_po.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_po.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'code', v_po.code, 'status', 'cancelled');
  end if;
  if v_po.lines is null or jsonb_typeof(v_po.lines) <> 'array' or jsonb_array_length(v_po.lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_lines', 'code', v_po.code);
  end if;

  v_reason := nullif(btrim(p_reason), '');
  v_subtotal := round(coalesce(v_po.subtotal, 0), 2);

  -- Giảm toàn phiếu = tổng giảm trên header - tổng giảm từng dòng (0086 ghi gộp).
  v_line_discount_sum := 0;
  for l in select value from jsonb_array_elements(v_po.lines) loop
    v_line_discount_sum := v_line_discount_sum + coalesce(nullif(l->>'discount_amount', '')::numeric, 0);
  end loop;
  v_order_discount := greatest(round(coalesce(v_po.discount_amount, 0) - v_line_discount_sum, 2), 0);

  -- Pass 1: resolve hàng hóa + tính lại giá net y hệt 0086 Pass 2.
  v_items := '[]'::jsonb;
  v_skipped := '[]'::jsonb;
  v_total_gross := 0;
  for l in select value from jsonb_array_elements(v_po.lines) loop
    v_qty := coalesce(nullif(l->>'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(l->>'import_price', '')::numeric, 0);
    if v_qty <= 0 or v_price <= 0 then
      continue;
    end if;
    v_line_discount := coalesce(nullif(l->>'discount_amount', '')::numeric, 0);
    v_sku := nullif(btrim(l->>'sku'), '');
    v_ref := null;
    if coalesce(l->>'product_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      v_ref := (l->>'product_id')::uuid;
    end if;
    v_pid := null;
    if v_sku is not null then
      select id into v_pid from public.products where sku = v_sku;
    end if;
    if v_pid is null and v_ref is not null then
      select id into v_pid from public.products where id = v_ref;
    end if;
    if v_pid is null then
      v_skipped := v_skipped || to_jsonb(coalesce(v_sku, l->>'product_id', ''));
      continue;
    end if;

    v_line_gross := round(v_qty * v_price, 2);
    v_total_gross := v_total_gross + v_line_gross;
    v_alloc := case when v_total_gross > 0 and v_subtotal > 0
      then round(v_order_discount * (v_line_gross / v_subtotal), 2)
      else 0 end;
    v_net := round((v_line_gross - round(v_line_discount + v_alloc, 2)) / v_qty, 2);
    v_items := v_items || jsonb_build_object('pid', v_pid, 'sku', v_sku, 'qty', v_qty, 'net', v_net);
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_products', 'code', v_po.code, 'skipped', v_skipped);
  end if;

  -- Khóa hàng hóa theo thứ tự id để tránh deadlock khi 2 máy hủy cùng lúc.
  v_pids := array(select distinct (x->>'pid')::uuid from jsonb_array_elements(v_items) x);
  perform 1 from public.products where id = any(v_pids) order by id for update;

  -- Pass 2: trả tồn + hoàn MAC + ghi thẻ kho.
  v_products := '[]'::jsonb;
  v_clamped := '[]'::jsonb;
  for it in select value from jsonb_array_elements(v_items) loop
    v_pid := (it->>'pid')::uuid;
    v_qty := (it->>'qty')::numeric;
    v_net := (it->>'net')::numeric;
    select coalesce(stock_quantity, 0), coalesce(avg_cost, 0) into v_stock, v_avg
    from public.products where id = v_pid;
    v_new_stock := greatest(v_stock - v_qty, 0);
    if v_stock < v_qty then
      v_clamped := v_clamped || jsonb_build_object('sku', it->>'sku', 'missing', v_qty - v_stock);
    end if;
    v_new_avg := case when v_new_stock > 0
      then round((v_stock * v_avg - v_qty * v_net) / v_new_stock)
      else v_net end;
    update public.products
    set stock_quantity = v_new_stock, avg_cost = v_new_avg
    where id = v_pid;

    insert into public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type)
    values (v_po.code, v_pid, -v_qty, v_stock, v_new_stock,
      'Hủy phiếu nhập' || coalesce(' (' || v_reason || ')', '') ||
      ' - MAC: ' || v_avg::text || ' -> ' || v_new_avg::text ||
      ' (giá net: ' || v_net::text || ')',
      'import_void');

    v_products := v_products || jsonb_build_object(
      'product_id', v_pid,
      'sku', it->>'sku',
      'stock_quantity', v_new_stock,
      'avg_cost', v_new_avg);
  end loop;

  -- Giảm nợ NCC (không âm).
  v_supplier_debt := null;
  if coalesce(v_po.debt_amount, 0) > 0 and v_po.supplier_id is not null then
    update public.suppliers
    set current_debt = greatest(coalesce(current_debt, 0) - v_po.debt_amount, 0)
    where id = v_po.supplier_id
    returning current_debt into v_supplier_debt;
  end if;

  -- Hoàn tiền: hoàn đúng số phiếu chi đã tạo cho phiếu này (bỏ qua PT hoàn cũ).
  v_cash := null;
  select sum(amount), min(fund_type), min(category), min(partner_name)
  into v_refund, v_fund, v_category, v_partner
  from public.cashbook_entries
  where reference_order_code = v_po.code
    and type = 'expense'
    and coalesce(client_ref, '') not like 'void:%';

  if coalesce(v_refund, 0) > 0 then
    begin
      insert into public.cashbook_entries (code, type, fund_type, category, amount, partner_name, reference_order_code, note, client_ref)
      values (public.generate_order_code('PT'), 'receipt', coalesce(v_fund, 'cash'), coalesce(v_category, 'material'),
        v_refund, v_partner, v_po.code,
        'Hoàn tiền hủy phiếu nhập ' || v_po.code || coalesce(' (' || v_reason || ')', ''),
        'void:' || v_po.code)
      returning to_jsonb(cashbook_entries.*) into v_cash;
    exception when unique_violation then
      v_cash := null;
    end;
  end if;

  update public.purchase_orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = v_reason
  where id = v_po.id;

  return jsonb_build_object(
    'ok', true,
    'code', v_po.code,
    'status', 'cancelled',
    'supplier_id', v_po.supplier_id,
    'supplier_debt', v_supplier_debt,
    'products', v_products,
    'cash', v_cash,
    'clamped', v_clamped,
    'skipped', v_skipped,
    'voided_at', now()
  );
end; $$;

revoke all on function public.void_stock_import(text, uuid, text, text) from public, anon;
grant execute on function public.void_stock_import(text, uuid, text, text) to authenticated;

NOTIFY pgrst, 'reload schema';
