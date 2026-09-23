-- Migration 48 — Nâng cấp sync_stock_import hỗ trợ ghi nợ & thanh toán 1 phần NCC.
create or replace function public.sync_stock_import(
  p_client_ref text,
  p_code text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_lines jsonb,
  p_total numeric,
  p_paid numeric default null,
  p_debt numeric default null
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
  v_actual_paid numeric;
  v_actual_debt numeric;
  v_status text;
begin
  if p_client_ref is not null and exists (select 1 from public.purchase_orders where client_ref = p_client_ref) then
    return jsonb_build_object('ok', true, 'imported', false);
  end if;

  v_actual_paid := coalesce(p_paid, p_total);
  v_actual_debt := coalesce(p_debt, p_total - v_actual_paid);
  if v_actual_debt < 0 then v_actual_debt := 0; end if;

  v_status := case
    when v_actual_debt <= 0 then 'completed'
    when v_actual_paid <= 0 then 'debt'
    else 'partial'
  end;

  insert into public.purchase_orders (code, supplier_id, subtotal, discount_amount, total_amount, paid_amount, debt_amount, status, client_ref)
  values (p_code, p_supplier_id, coalesce(p_total, 0), 0, coalesce(p_total, 0), v_actual_paid, v_actual_debt, v_status, p_client_ref)
  on conflict (code) do nothing
  returning id into v_po_id;

  if v_po_id is null then
    return jsonb_build_object('ok', true, 'imported', false);
  end if;

  -- Nếu có nợ NCC và supplier_id hợp lệ -> cộng vào current_debt của nhà cung cấp
  if v_actual_debt > 0 and p_supplier_id is not null then
    update public.suppliers
    set current_debt = current_debt + v_actual_debt
    where id = p_supplier_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((l->>'quantity')::numeric, 0);
    v_price := coalesce((l->>'import_price')::numeric, 0);
    if v_qty <= 0 or v_price <= 0 then continue; end if;

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

revoke all on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric) from public, anon;
grant execute on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric) to authenticated;
