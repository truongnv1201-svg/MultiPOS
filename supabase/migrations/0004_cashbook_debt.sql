-- Migration 04 — Sổ quỹ, công nợ, trả/hủy (FIN-ERR-01..05, FIN-ERR-03 clamp)

create table if not exists public.cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, -- PT/PC-YYMMDD-XXXX
  type text not null check (type in ('receipt','expense')),
  fund_type text not null check (fund_type in ('cash','bank')),
  category text not null check (category in ('sales','deposit','debt_collection','supplier_payment','labor','material','other')),
  amount numeric(12,2) not null check (amount > 0),
  reference_order_code text,
  partner_name text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- Thu nợ đa kỳ: so trực tiếp orders.debt_amount FOR UPDATE (FIN-ERR-02), clamp (FIN-ERR-03)
create or replace function public.collect_debt(p_customer_id uuid, p_amount numeric, p_method text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_debt numeric; v_take numeric;
begin
  select current_debt into v_debt from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Khách hàng không tồn tại'; end if;
  v_take := least(p_amount, v_debt); -- clamp không âm
  update public.customers set current_debt = current_debt - v_take where id = p_customer_id;
  insert into public.cashbook_entries (code, type, fund_type, category, amount, partner_name, note)
  values (public.generate_order_code('PT'), 'receipt',
    case when p_method='cash' then 'cash' else 'bank' end,
    'debt_collection', v_take,
    (select name from public.customers where id = p_customer_id), coalesce(p_note,'Thu nợ'));
  return jsonb_build_object('ok', true, 'collected', v_take);
end; $$;

-- Trả hàng: giảm nợ tối đa = nợ hiện hữu, dư hoàn tiền mặt (FIN-ERR-03 + INV-ERR-04)
create or replace function public.return_order_items(p_order_id uuid, p_refund numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cust uuid; v_debt numeric; v_cut numeric; v_cash numeric;
begin
  select customer_id into v_cust from public.orders where id = p_order_id for update;
  if not found then raise exception 'Đơn không tồn tại'; end if;
  if v_cust is not null then
    select current_debt into v_debt from public.customers where id = v_cust for update;
    v_cut := least(p_refund, v_debt);
    v_cash := p_refund - v_cut;
    update public.customers set current_debt = current_debt - v_cut where id = v_cust;
  else
    v_cut := 0; v_cash := p_refund;
  end if;
  if v_cash > 0 then
    insert into public.cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
    values (public.generate_order_code('PC'), 'expense', 'cash', 'other', v_cash,
      (select order_code from public.orders where id = p_order_id), 'Hoàn tiền trả hàng');
  end if;
  update public.orders set status='returned', updated_at=now() where id = p_order_id;
  return jsonb_build_object('ok', true, 'debt_cut', v_cut, 'cash_refund', v_cash);
end; $$;

-- Hủy đơn: hoàn đúng từng quỹ gốc (FIN-ERR-05) — đọc payments từ cashbook reference
create or replace function public.cancel_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_code text;
begin
  select * into r from public.orders where id = p_order_id for update;
  if not found or r.status = 'cancelled' then raise exception 'Đơn không hợp lệ'; end if;
  -- Hoàn từng dòng cashbook gốc
  for r in select * from public.cashbook_entries where reference_order_code = (select order_code from public.orders where id = p_order_id) and type='receipt' loop
    insert into public.cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
    values (public.generate_order_code('PC'), 'expense', r.fund_type, 'other', r.amount, r.reference_order_code, 'Hủy đơn hoàn ' || r.fund_type);
  end loop;
  update public.orders set status='cancelled', updated_at=now() where id = p_order_id;
  return jsonb_build_object('ok', true);
end; $$;
