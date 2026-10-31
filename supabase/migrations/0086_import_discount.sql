-- Migration 0086 — Hỗ trợ chiết khấu trên phiếu nhập (discount per line + order-level).
-- Vấn đề: sync_stock_import không nhận chiết khấu -> đơn giá lưu là giá gross,
-- MAC và nợ NCC tính sai khi NCC giảm giá.
-- Thay đổi:
-- 1) Tham số p_order_discount: giảm toàn phiếu (tiền).
-- 2) Mỗi phần tử trong p_lines có thêm discount_amount (giảm trực tiếp trên dòng).
-- 3) Tính giá nhập net = (qty × import_price - line_discount - order_discount_alloc) / qty.
--    Dùng giá net cho MAC và cập nhật products.import_price.
-- 4) Header purchase_orders: discount_amount = tổng giảm, total_amount = subtotal - discount_amount.
-- 5) Validation: discount_amount mỗi dòng không vượt quá qty × import_price;
--    tổng giảm (dòng + phiếu) không vượt quá tiền hàng gross.

drop function if exists public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric, text, numeric);

create or replace function public.sync_stock_import(
  p_client_ref text,
  p_code text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_lines jsonb,
  p_total numeric,
  p_paid numeric default null,
  p_debt numeric default null,
  p_note text default null,
  p_order_discount numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  v_pid uuid;
  v_checked_pid uuid;
  v_sku text;
  v_product_ref uuid;
  v_stock numeric;
  v_avg numeric;
  v_qty numeric;
  v_price numeric;
  v_line_discount numeric;
  v_order_discount_alloc numeric;
  v_total_line_discount numeric;
  v_net_price numeric;
  v_new_stock numeric;
  v_new_avg numeric;
  v_po_id uuid;
  v_actual_total numeric;
  v_actual_total_net numeric;
  v_actual_paid numeric;
  v_actual_debt numeric;
  v_actual_discount numeric;
  v_status text;
  v_sup_id uuid;
  v_sup_name text;
  v_code text;
  v_auto boolean;
  v_sup_count integer;
  v_note text;
  v_total_gross numeric;
  v_order_discount numeric;
  v_line_gross numeric;
begin
  if not public.is_manager() then
    raise exception 'Chỉ Admin/Quản lý được nhập kho';
  end if;
  if p_client_ref is null or btrim(p_client_ref) = '' then
    raise exception 'Thiếu client_ref cho phiếu nhập';
  end if;

  v_order_discount := coalesce(p_order_discount, 0);
  if v_order_discount < 0 then
    raise exception 'Giảm giá toàn phiếu không được âm';
  end if;

  -- 0073: server đánh số phiếu (như HD). Client mới gửi p_code null/''; server sinh
  -- qua generate_order_code('NH'). Client cũ gửi mã cụ thể -> giữ nguyên hành vi.
  v_auto := (p_code is null or btrim(p_code) = '');
  if v_auto then
    v_code := public.generate_order_code('NH');
  else
    v_code := btrim(p_code);
  end if;
  if v_auto then
    for i in 1..10 loop
      exit when not exists (select 1 from public.purchase_orders where code = v_code);
      v_code := public.generate_order_code('NH');
    end loop;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Phiếu nhập phải có ít nhất một dòng hàng';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu nhập phải có ít nhất một dòng hàng';
  end if;
  if p_client_ref is not null and exists (select 1 from public.purchase_orders where client_ref = p_client_ref) then
    return jsonb_build_object('ok', true, 'imported', false, 'duplicate', true);
  end if;

  v_note := nullif(btrim(p_note), '');

  -- Pass 1: validate từng dòng, tính tổng gross và tổng giảm dòng
  v_actual_total := 0;
  v_actual_discount := 0;
  for l in select value from jsonb_array_elements(p_lines) loop
    v_qty := nullif(l->>'quantity', '')::numeric;
    v_price := nullif(l->>'import_price', '')::numeric;
    v_line_discount := nullif(l->>'discount_amount', '')::numeric;
    if v_qty is null or v_price is null or v_qty <= 0 or v_price <= 0
      or v_qty::text in ('NaN', 'Infinity', '-Infinity')
      or v_price::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Dòng nhập không hợp lệ: số lượng và đơn giá phải lớn hơn 0';
    end if;
    if v_line_discount is null then
      v_line_discount := 0;
    end if;
    if v_line_discount < 0 or v_line_discount > v_qty * v_price then
      raise exception 'Chiết khấu dòng không hợp lệ: phải từ 0 đến thành tiền dòng';
    end if;

    v_sku := nullif(btrim(l->>'sku'), '');
    v_product_ref := null;
    if nullif(btrim(l->>'product_id'), '') is not null then
      if (l->>'product_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'Mã hàng không hợp lệ: %', l->>'product_id';
      end if;
      v_product_ref := (l->>'product_id')::uuid;
    end if;

    v_pid := null;
    if v_sku is not null then
      select id into v_pid from public.products where sku = v_sku for update;
    end if;
    if v_pid is null and v_product_ref is not null then
      select id into v_pid from public.products where id = v_product_ref for update;
    end if;
    if v_pid is null then
      raise exception 'Không tìm thấy hàng hóa trong danh mục server: %', coalesce(v_sku, l->>'product_id');
    end if;
    if v_product_ref is not null then
      select id into v_checked_pid from public.products where id = v_product_ref;
      if v_checked_pid is not null and v_checked_pid <> v_pid then
        raise exception 'SKU và mã hàng không cùng một sản phẩm: %', v_sku;
      end if;
    end if;

    v_line_gross := round(v_qty * v_price, 2);
    v_actual_total := v_actual_total + v_line_gross;
    v_actual_discount := v_actual_discount + v_line_discount;
  end loop;
  v_actual_total := round(v_actual_total, 2);

  -- Kiểm tra giảm toàn phiếu không vượt quá gross - giảm dòng
  if v_order_discount > v_actual_total - v_actual_discount then
    raise exception 'Giảm giá toàn phiếu vượt quá tiền hàng sau khi trừ giảm các dòng';
  end if;

  -- Thành tiền thực sau tất cả giảm (cần có trước khi validate paid)
  v_actual_discount := round(v_actual_discount + v_order_discount, 2);
  v_actual_total_net := round(v_actual_total - v_actual_discount, 2);

  if p_total is not null and (p_total::text in ('NaN', 'Infinity', '-Infinity') or p_total < 0 or round(p_total, 2) <> v_actual_total) then
    raise exception 'Tổng tiền phiếu không khớp dòng hàng';
  end if;
  if p_paid is not null and p_paid::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Số tiền đã thanh toán không hợp lệ';
  end if;
  v_actual_paid := round(coalesce(p_paid, v_actual_total_net), 2);
  if v_actual_paid < 0 or v_actual_paid > v_actual_total_net then
    raise exception 'Số tiền đã thanh toán không hợp lệ (vượt quá thành tiền thực)';
  end if;
  if p_debt is not null and p_debt::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Số tiền còn nợ không khớp tổng phiếu';
  end if;

  v_actual_debt := round(v_actual_total_net - v_actual_paid, 2);
  if p_debt is not null and (p_debt < 0 or round(p_debt, 2) <> v_actual_debt) then
    raise exception 'Số tiền còn nợ không khớp tổng phiếu';
  end if;

  v_sup_id := p_supplier_id;
  if v_sup_id is not null then
    select name into v_sup_name from public.suppliers where id = v_sup_id;
    if v_sup_name is null then
      raise exception 'Nhà cung cấp không tồn tại: %', v_sup_id;
    end if;
  elsif nullif(btrim(p_supplier_name), '') is not null then
    select count(*) into v_sup_count
    from public.suppliers
    where lower(btrim(name)) = lower(btrim(p_supplier_name));
    if v_sup_count > 1 then
      if v_actual_debt > 0 then
        raise exception 'Tên nhà cung cấp không duy nhất: %', p_supplier_name;
      end if;
    elsif v_sup_count = 1 then
      select id, name into v_sup_id, v_sup_name from public.suppliers
      where lower(btrim(name)) = lower(btrim(p_supplier_name));
    end if;
  end if;
  v_sup_name := coalesce(v_sup_name, nullif(btrim(p_supplier_name), ''), '');
  if v_actual_debt > 0 and v_sup_id is null then
    raise exception 'Nợ vô chủ: nhà cung cấp "%" chưa có trong danh mục server. Đồng bộ/tạo NCC trước khi ghi nợ.', p_supplier_name;
  end if;

  v_status := case
    when v_actual_debt <= 0 then 'completed'
    when v_actual_paid <= 0 then 'debt'
    else 'partial'
  end;

  -- Ghi phiếu: discount_amount = tổng giảm, total_amount = subtotal - discount_amount
  for attempt in 1..3 loop
    begin
      insert into public.purchase_orders (code, supplier_id, subtotal, discount_amount, total_amount, paid_amount, debt_amount, status, client_ref, note, lines)
      values (v_code, v_sup_id, v_actual_total, v_actual_discount, v_actual_total_net, v_actual_paid, v_actual_debt, v_status, p_client_ref, v_note, p_lines)
      returning id into v_po_id;
      exit;
    exception when unique_violation then
      if exists (select 1 from public.purchase_orders where client_ref = p_client_ref) then
        return jsonb_build_object('ok', true, 'imported', false, 'duplicate', true);
      end if;
      if not v_auto or attempt = 3 then
        raise exception 'Mã phiếu nhập đã tồn tại: %', v_code;
      end if;
      v_code := public.generate_order_code('NH');
    end;
  end loop;

  if v_actual_debt > 0 then
    update public.suppliers
    set current_debt = current_debt + v_actual_debt
    where id = v_sup_id;
    if not found then
      raise exception 'Không tìm thấy nhà cung cấp để ghi nợ';
    end if;
  end if;

  -- Pass 2: tính MAC bằng giá net, cập nhật tồn kho + thẻ kho
  v_total_gross := 0;
  for l in select value from jsonb_array_elements(p_lines) loop
    v_qty := (l->>'quantity')::numeric;
    v_price := (l->>'import_price')::numeric;
    v_line_discount := coalesce(nullif(l->>'discount_amount', '')::numeric, 0);
    v_sku := nullif(btrim(l->>'sku'), '');
    v_product_ref := nullif(btrim(l->>'product_id'), '')::uuid;
    v_pid := null;
    if v_sku is not null then
      select id into v_pid from public.products where sku = v_sku for update;
    end if;
    if v_pid is null and v_product_ref is not null then
      select id into v_pid from public.products where id = v_product_ref for update;
    end if;
    if v_pid is null then
      raise exception 'Không tìm thấy hàng hóa trong danh mục server: %', coalesce(v_sku, l->>'product_id');
    end if;

    v_line_gross := round(v_qty * v_price, 2);
    v_total_gross := v_total_gross + v_line_gross;
    -- Phân bổ giảm toàn phiếu theo tỉ lệ giá trị gross từng dòng
    v_order_discount_alloc := case when v_total_gross > 0
      then round(v_order_discount * (v_line_gross / v_actual_total), 2)
      else 0 end;
    v_total_line_discount := round(v_line_discount + v_order_discount_alloc, 2);
    -- Giá nhập net (sau tất cả giảm)
    v_net_price := case when v_qty > 0
      then round((v_line_gross - v_total_line_discount) / v_qty, 2)
      else v_price end;

    select stock_quantity, avg_cost into v_stock, v_avg from public.products where id = v_pid;
    v_stock := coalesce(v_stock, 0);
    v_avg := coalesce(v_avg, 0);
    v_new_stock := v_stock + v_qty;
    v_new_avg := case when v_new_stock > 0
      then round((v_stock * v_avg + v_qty * v_net_price) / v_new_stock)
      else v_net_price end;

    update public.products
    set stock_quantity = v_new_stock, avg_cost = v_new_avg, import_price = v_net_price
    where id = v_pid;

    insert into public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type)
    values (v_code, v_pid, v_qty, v_stock, v_new_stock,
      'Nhập kho (' || v_sup_name || ')' ||
      ' - MAC: ' || v_avg::text || ' -> ' || v_new_avg::text ||
      ' (giá net: ' || v_net_price::text || ')',
      'import');
  end loop;

  return jsonb_build_object(
    'ok', true,
    'imported', true,
    'code', v_code,
    'total_amount', v_actual_total_net,
    'paid_amount', v_actual_paid,
    'debt_amount', v_actual_debt,
    'discount_amount', v_actual_discount
  );
end; $$;

revoke all on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric, text, numeric) from public, anon;
grant execute on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric, text, numeric) to authenticated;

NOTIFY pgrst, 'reload schema';
