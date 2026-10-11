-- Migration 0081 — Nhập hàng hóa hàng loạt (file Excel nghìn dòng).
-- Bệnh: client gọi addProduct/updateProduct từng dòng (1+ round-trip/dòng),
-- file 5000 dòng mất hàng chục phút, lỗi giữa chừng là kẹt.
-- Fix: RPC nhận mảng dòng, upsert theo SKU (có mã) hoặc tên+ĐVT (không mã),
-- SKU trống sinh nối tiếp max SP trong cùng call (khóa advisory, khớp numbering
-- client dùng maxSpNumber). Lỗi từng dòng gom vào response, không abort cả lô.
-- Client chia chunk 500 dòng/call (giới hạn 2000/call phòng payload quá lớn).

create or replace function public.import_products_bulk(p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  idx integer := -1;
  v_name text;
  v_sku text;
  v_unit text;
  v_ptype text;
  v_retail numeric; v_import numeric; v_avg numeric; v_stock numeric;
  v_min numeric; v_waste numeric;
  v_decimal boolean;
  v_next integer;
  v_pid uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if not public.is_manager() then
    raise exception 'Chỉ Admin/Quản lý được nhập hàng hóa hàng loạt';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Danh sách hàng hóa phải là mảng';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', true, 'created', 0, 'updated', 0, 'errors', v_errors);
  end if;
  if jsonb_array_length(p_lines) > 2000 then
    raise exception 'Mỗi lần tối đa 2000 dòng (chia nhỏ file ra)';
  end if;

  -- Khóa numbering SKU trong transaction để 2 máy nhập cùng lúc không trùng mã.
  perform pg_advisory_xact_lock(hashtext('product_sp_seq'));
  select coalesce(max(substring(sku from 3)::integer), 0) into v_next
  from public.products where sku ~ '^SP[0-9]+$';

  for l in select value from jsonb_array_elements(p_lines) loop
    idx := idx + 1;
    begin
      v_name := nullif(btrim(l->>'name'), '');
      if v_name is null then raise exception 'thiếu Tên hàng'; end if;
      v_sku := nullif(btrim(l->>'sku'), '');
      v_unit := coalesce(nullif(btrim(l->>'unit'), ''), 'cái');
      v_ptype := lower(coalesce(nullif(btrim(l->>'product_type'), ''), 'goods'));
      if v_ptype not in ('goods', 'area', 'combo', 'service') then v_ptype := 'goods'; end if;
      -- Số rác (chữ/NaN/Infinity) -> lỗi dòng đó, các dòng khác vẫn chạy.
      if (l->>'retail_price') in ('NaN', 'Infinity', '-Infinity')
        or (l->>'import_price') in ('NaN', 'Infinity', '-Infinity')
        or (l->>'avg_cost') in ('NaN', 'Infinity', '-Infinity')
        or (l->>'stock_quantity') in ('NaN', 'Infinity', '-Infinity') then
        raise exception 'số tiền/số lượng không hợp lệ';
      end if;
      v_retail := greatest(coalesce(nullif(l->>'retail_price', '')::numeric, 0), 0);
      v_import := greatest(coalesce(nullif(l->>'import_price', '')::numeric, 0), 0);
      v_avg := greatest(coalesce(nullif(l->>'avg_cost', '')::numeric, v_import), 0);
      v_stock := greatest(coalesce(nullif(l->>'stock_quantity', '')::numeric, 0), 0);
      v_min := greatest(coalesce(nullif(l->>'min_stock', '')::numeric, 0), 0);
      v_waste := greatest(coalesce(nullif(l->>'waste_factor', '')::numeric, 0), 0);
      v_decimal := coalesce((l->>'allow_decimal')::boolean, false) or v_ptype = 'area';

      if v_sku is not null then
        select id into v_pid from public.products where sku = v_sku;
      else
        select id into v_pid from public.products
        where lower(name) = lower(v_name) and lower(unit) = lower(v_unit)
        limit 1;
      end if;

      if v_pid is not null then
        update public.products set
          name = v_name, unit = v_unit, product_type = v_ptype,
          retail_price = v_retail, import_price = v_import, avg_cost = v_avg,
          stock_quantity = v_stock, min_stock = v_min, waste_factor = v_waste,
          allow_decimal = v_decimal
        where id = v_pid;
        v_updated := v_updated + 1;
      else
        if v_sku is null then
          loop
            v_next := v_next + 1;
            v_sku := 'SP' || lpad(v_next::text, 6, '0');
            exit when not exists (select 1 from public.products where sku = v_sku);
          end loop;
        end if;
        insert into public.products
          (sku, name, unit, product_type, retail_price, import_price, avg_cost,
           stock_quantity, min_stock, waste_factor, allow_decimal)
        values (v_sku, v_name, v_unit, v_ptype, v_retail, v_import, v_avg,
          v_stock, v_min, v_waste, v_decimal);
        v_created := v_created + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'index', idx, 'sku', l->>'sku', 'name', l->>'name', 'error', SQLERRM);
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'created', v_created, 'updated', v_updated, 'errors', v_errors);
end; $$;

revoke all on function public.import_products_bulk(jsonb) from public, anon;
grant execute on function public.import_products_bulk(jsonb) to authenticated;
