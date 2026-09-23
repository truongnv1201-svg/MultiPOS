-- Migration 42 — Đồng bộ Nhập kho / Trả nợ NCC / Phiếu thu-chi tay (P0).
-- Vấn đề: importStock*, paySupplierDebt, addCashbookEntry chỉ ghi Dexie local;
-- lần pull refreshCatalog sau (server-wins) ghi đè tồn kho + nợ NCC, mất số liệu.
-- Thiết kế (local-first + server hội tụ):
-- 1) purchase_orders: RLS đọc/ghi authenticated (màn Nhập kho chỉ Admin/Quản lý ở
--    client;inoza mở policy như projects để khỏi kẹt vai trò worker).
-- 2) client_ref (unique, nullable) chống đẩy 2 lần khi retry/offline-replay.
-- 3) 3 RPC SECURITY DEFINER + GRANT tường minh authenticated:
--    - sync_stock_import: dedupe theo client_ref; server tự tính lại MAC theo
--      tồn server (chuẩn hơn MAC client tính từ tồn local); ghi stock_movements.
--    - pay_supplier_debt: mirror collect_debt — clamp theo nợ thật, trừ
--      suppliers.current_debt, ghi PC supplier_payment; trả {paid} để client mirror.
--    - record_cashbook_voucher: ghi phiếu thu/chi tay (backup/audit; sổ quỹ từng
--      máy vẫn xem local, server không pull về).
-- 4) Mở rộng category cashbook thêm 'advance' (client dùng Tạm ứng lương).

-- 1) client_ref dedupe
alter table public.purchase_orders
  add column if not exists client_ref text;
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_purchase_orders_client_ref') then
    create unique index uq_purchase_orders_client_ref on public.purchase_orders(client_ref);
  end if;
end $$;

alter table public.cashbook_entries
  add column if not exists client_ref text;
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_cashbook_client_ref') then
    create unique index uq_cashbook_client_ref on public.cashbook_entries(client_ref);
  end if;
end $$;

-- category 'advance': tạm ứng lương (client CashbookView dùng)
alter table public.cashbook_entries drop constraint if exists cashbook_entries_category_check;
alter table public.cashbook_entries
  add constraint cashbook_entries_category_check check (category in ('sales','deposit','debt_collection','supplier_payment','labor','material','advance','other'));

-- 2) RLS purchase_orders (bật từ 0006 nhưng chưa có policy nào)
drop policy if exists "purchase_orders_read" on public.purchase_orders;
create policy "purchase_orders_read" on public.purchase_orders
  for select to authenticated using (true);
drop policy if exists "purchase_orders_write" on public.purchase_orders;
create policy "purchase_orders_write" on public.purchase_orders
  for all to authenticated using (true) with check (true);

-- 3a) Nhập kho: p_lines [{sku, product_id, quantity, import_price}]
-- MAC tính lại từ tồn server cho chuẩn; sku dùng để map khi id chưa đồng bộ.
create or replace function public.sync_stock_import(
  p_client_ref text,
  p_code text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_lines jsonb,
  p_total numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  v_pid uuid;
  v_stock numeric;
  v_avg numeric;
  v_qty numeric;
  v_price numeric;
  v_new_stock numeric;
  v_new_avg numeric;
  v_po_id uuid;
begin
  if p_client_ref is not null and exists (select 1 from public.purchase_orders where client_ref = p_client_ref) then
    return jsonb_build_object('ok', true, 'imported', false);
  end if;

  insert into public.purchase_orders (code, supplier_id, subtotal, discount_amount, total_amount, paid_amount, debt_amount, status, client_ref)
  values (p_code, p_supplier_id, coalesce(p_total, 0), 0, coalesce(p_total, 0), coalesce(p_total, 0), 0, 'completed', p_client_ref)
  on conflict (code) do nothing
  returning id into v_po_id;
  if v_po_id is null then
    -- code trùng (máy khác nhập cùng mã): coi như đã đồng bộ, không trừ 2 lần
    return jsonb_build_object('ok', true, 'imported', false);
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((l->>'quantity')::numeric, 0);
    v_price := coalesce((l->>'import_price')::numeric, 0);
    if v_qty <= 0 or v_price <= 0 then continue; end if;
    -- map sản phẩm: ưu tiên sku (ổn định qua đồng bộ), fallback id uuid
    select id into v_pid from public.products where sku = (l->>'sku') for update;
    if v_pid is null and (l->>'product_id') ~ '^[0-9a-fA-F-]{36}$' then
      select id into v_pid from public.products where id = (l->>'product_id')::uuid for update;
    end if;
    if v_pid is null then continue; end if;
    select stock_quantity, avg_cost into v_stock, v_avg from public.products where id = v_pid;
    v_new_stock := v_stock + v_qty;
    v_new_avg := case when v_new_stock > 0
      then round((v_stock * coalesce(v_avg, 0) + v_qty * v_price) / v_new_stock)
      else v_price end;
    update public.products
    set stock_quantity = v_new_stock, avg_cost = v_new_avg, import_price = v_price
    where id = v_pid;
    insert into public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note)
    values (p_code, v_pid, v_qty, v_stock, v_new_stock,
      'Nhập kho (' || coalesce(p_supplier_name, '') || ') - MAC: ' || coalesce(v_avg, 0)::text || ' -> ' || v_new_avg::text);
  end loop;

  return jsonb_build_object('ok', true, 'imported', true);
end; $$;
revoke all on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric) from public, anon;
grant execute on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric) to authenticated;

-- 3b) Trả nợ NCC (mirror collect_debt): clamp + trừ nợ + ghi PC
create or replace function public.pay_supplier_debt(
  p_client_ref text,
  p_supplier_id uuid,
  p_amount numeric,
  p_method text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_debt numeric; v_pay numeric;
begin
  if p_client_ref is not null and exists (select 1 from public.cashbook_entries where client_ref = p_client_ref) then
    select greatest(coalesce((select current_debt from public.suppliers where id = p_supplier_id), 0), 0) into v_debt;
    return jsonb_build_object('ok', true, 'paid', 0, 'debt', v_debt, 'duplicate', true);
  end if;
  select current_debt into v_debt from public.suppliers where id = p_supplier_id for update;
  if not found then raise exception 'Nhà cung cấp không tồn tại'; end if;
  v_pay := least(coalesce(p_amount, 0), v_debt);
  update public.suppliers set current_debt = current_debt - v_pay where id = p_supplier_id;
  insert into public.cashbook_entries (code, type, fund_type, category, amount, partner_name, note, client_ref)
  values (public.generate_order_code('PC'), 'expense',
    case when p_method = 'cash' then 'cash' else 'bank' end,
    'supplier_payment', v_pay,
    (select name from public.suppliers where id = p_supplier_id), coalesce(p_note, 'Chi trả nợ NCC'),
    p_client_ref);
  return jsonb_build_object('ok', true, 'paid', v_pay, 'debt', v_debt - v_pay);
end; $$;
revoke all on function public.pay_supplier_debt(text, uuid, numeric, text, text) from public, anon;
grant execute on function public.pay_supplier_debt(text, uuid, numeric, text, text) to authenticated;

-- 3c) Phiếu thu/chi tay (backup/audit, server không pull về máy)
create or replace function public.record_cashbook_voucher(
  p_client_ref text,
  p_type text,
  p_fund_type text,
  p_category text,
  p_amount numeric,
  p_partner_name text,
  p_reference text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cat text;
begin
  if p_client_ref is not null and exists (select 1 from public.cashbook_entries where client_ref = p_client_ref) then
    return jsonb_build_object('ok', true, 'synced', false);
  end if;
  v_cat := case when p_category in ('sales','deposit','debt_collection','supplier_payment','labor','material','advance','other')
    then p_category else 'other' end;
  if p_type not in ('receipt', 'expense') then raise exception 'Loại phiếu không hợp lệ'; end if;
  if p_fund_type not in ('cash', 'bank') then raise exception 'Quỹ không hợp lệ'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  insert into public.cashbook_entries (code, type, fund_type, category, amount, partner_name, reference_order_code, note, client_ref)
  values (public.generate_order_code(case when p_type = 'receipt' then 'PT' else 'PC' end),
    p_type, p_fund_type, v_cat, p_amount, p_partner_name, p_reference, p_note, p_client_ref);
  return jsonb_build_object('ok', true, 'synced', true);
end; $$;
revoke all on function public.record_cashbook_voucher(text, text, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.record_cashbook_voucher(text, text, text, text, numeric, text, text, text) to authenticated;

NOTIFY pgrst, 'reload schema';
