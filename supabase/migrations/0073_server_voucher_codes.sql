-- Migration 0073 — Server đánh số phiếu NH/PQ như HD (thống nhất, khỏi client gánh).
-- Bệnh: HD do server sinh qua generate_order_code (advisory lock, chuẩn nối tiếp),
-- còn NH/PQ do client tự đánh (quét max local + max server rồi bump, retry khi trùng).
-- 2 máy cùng số đầu ngày -> trùng mã, đường replay phải vá mã + gửi lại (tối đa 3 lần).
-- Fix: 2 RPC tự sinh mã khi client gửi p_code null/'' (mặc định mới), trả 'code' trong
-- jsonb để client vá local. Client cũ gửi mã cụ thể -> giữ nguyên hành vi (trùng NH
-- vẫn báo 'Mã phiếu nhập đã tồn tại'). Không đổi signature -> PostgREST khỏi rè cache,
-- client cũ không gãy. Sequence ngày reset từ 1 nên có vòng quét va chạm mã thời
-- client-era trước khi ghi + retry unique_violation cho mã auto (PQ không unique nên
-- khỏi vòng này). Client refactor ở: importStockBatch (shift-stock), syncPendingOps
-- (debts), adjustStock (projects).

drop function if exists public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric);

create or replace function public.sync_stock_import(
  p_client_ref text,
  p_code text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_lines jsonb,
  p_total numeric,
  p_paid numeric default null,
  p_debt numeric default null,
  p_note text default null
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
  v_new_stock numeric;
  v_new_avg numeric;
  v_po_id uuid;
  v_actual_total numeric;
  v_actual_paid numeric;
  v_actual_debt numeric;
  v_status text;
  v_sup_id uuid;
  v_sup_name text;
  v_code text;
  v_auto boolean;
  v_sup_count integer;
  v_note text;
begin
  if not public.is_manager() then
    raise exception 'Chỉ Admin/Quản lý được nhập kho';
  end if;
  if p_client_ref is null or btrim(p_client_ref) = '' then
    raise exception 'Thiếu client_ref cho phiếu nhập';
  end if;
  -- 0073: server đánh số phiếu (như HD). Client mới gửi p_code null/''; server sinh
  -- qua generate_order_code('NH'). Client cũ gửi mã cụ thể -> giữ nguyên hành vi
  -- (trùng thì báo 'Mã phiếu nhập đã tồn tại' như trước).
  v_auto := (p_code is null or btrim(p_code) = '');
  if v_auto then
    v_code := public.generate_order_code('NH');
  else
    v_code := btrim(p_code);
  end if;
  -- Sequence ngày reset từ 1, còn mã thời client-era có thể đã chiếm số cao trong
  -- ngày -> quét va chạm trước khi ghi (quá 10 số thì để unique_violation xử lý).
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

  v_actual_total := 0;
  for l in select value from jsonb_array_elements(p_lines) loop
    v_qty := nullif(l->>'quantity', '')::numeric;
    v_price := nullif(l->>'import_price', '')::numeric;
    if v_qty is null or v_price is null or v_qty <= 0 or v_price <= 0
      or v_qty::text in ('NaN', 'Infinity', '-Infinity')
      or v_price::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Dòng nhập không hợp lệ: số lượng và đơn giá phải lớn hơn 0';
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
    v_actual_total := v_actual_total + v_qty * v_price;
  end loop;
  v_actual_total := round(v_actual_total, 2);

  if p_total is not null and (p_total::text in ('NaN', 'Infinity', '-Infinity') or p_total < 0 or round(p_total, 2) <> v_actual_total) then
    raise exception 'Tổng tiền phiếu không khớp dòng hàng';
  end if;
  if p_paid is not null and p_paid::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Số tiền đã thanh toán không hợp lệ';
  end if;
  v_actual_paid := round(coalesce(p_paid, v_actual_total), 2);
  if v_actual_paid < 0 or v_actual_paid > v_actual_total then
    raise exception 'Số tiền đã thanh toán không hợp lệ';
  end if;
  if p_debt is not null and p_debt::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Số tiền còn nợ không khớp tổng phiếu';
  end if;
  v_actual_debt := round(v_actual_total - v_actual_paid, 2);
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

  -- Ghi phiếu: mã auto (hiếm) vẫn có thể đua với máy khác cùng giây -> thử số mới tối đa 3 lần.
  for attempt in 1..3 loop
    begin
      insert into public.purchase_orders (code, supplier_id, subtotal, discount_amount, total_amount, paid_amount, debt_amount, status, client_ref, note)
      values (v_code, v_sup_id, v_actual_total, 0, v_actual_total, v_actual_paid, v_actual_debt, v_status, p_client_ref, v_note)
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

  for l in select value from jsonb_array_elements(p_lines) loop
    v_qty := (l->>'quantity')::numeric;
    v_price := (l->>'import_price')::numeric;
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

    select stock_quantity, avg_cost into v_stock, v_avg from public.products where id = v_pid;
    v_stock := coalesce(v_stock, 0);
    v_avg := coalesce(v_avg, 0);
    v_new_stock := v_stock + v_qty;
    v_new_avg := case when v_new_stock > 0
      then round((v_stock * v_avg + v_qty * v_price) / v_new_stock)
      else v_price end;

    update public.products
    set stock_quantity = v_new_stock, avg_cost = v_new_avg, import_price = v_price
    where id = v_pid;

    insert into public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type)
    values (v_code, v_pid, v_qty, v_stock, v_new_stock,
      'Nhập kho (' || v_sup_name || ')' ||
      case when v_note is null then '' else ' - Ghi chú: ' || v_note end ||
      ' - MAC: ' || v_avg::text || ' -> ' || v_new_avg::text,
      'import');
  end loop;

  return jsonb_build_object(
    'ok', true,
    'imported', true,
    'code', v_code,
    'total_amount', v_actual_total,
    'paid_amount', v_actual_paid,
    'debt_amount', v_actual_debt
  );
end; $$;

revoke all on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.sync_stock_import(text, text, uuid, text, jsonb, numeric, numeric, numeric, text) to authenticated;

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_code TEXT,
  p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sku TEXT;
  v_pid UUID;
  v_name TEXT;
  v_unit TEXT;
  v_type TEXT;
  v_stock NUMERIC;
  v_avg NUMERIC;
  v_counted NUMERIC;
  v_delta NUMERIC;
  v_delta_given NUMERIC;
  v_reason TEXT;
  v_note TEXT;
  v_project_id UUID;
  v_project_code TEXT;
  v_new NUMERIC;
  v_adj_id UUID;
  v_ref TEXT;
  v_code TEXT;
  v_inserted INT := 0;
  v_skipped INT := 0;
  v_loss_total NUMERIC := 0;
  v_dupes INT := 0;
  v_actor_name TEXT;
  x JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Phiếu điều chỉnh tồn trống';
  END IF;
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Chỉ Admin/Quản lý được điều chỉnh tồn kho';
  END IF;
  -- 0073: server đánh số phiếu (như HD). Client mới gửi p_code null/''; server sinh
  -- qua generate_order_code('PQ'). Client cũ gửi mã cụ thể -> giữ nguyên.
  -- stock_adjustments.code KHÔNG unique nên mã auto không thể va chạm.
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    v_code := public.generate_order_code('PQ');
  ELSE
    v_code := btrim(p_code);
  END IF;

  -- Cùng SKU 2 dòng trong 1 phiếu sẽ trừ 2 lần -> chặn ngay, client luôn gửi 1 dòng/hàng.
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT e->>'sku' AS sku
    FROM jsonb_array_elements(p_items) e
    GROUP BY e->>'sku'
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Phiếu điều chỉnh có SKU bị lặp, mỗi mặt hàng chỉ được 1 dòng';
  END IF;

  SELECT COALESCE(full_name, email, 'Quản lý') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  -- Khoá toàn bộ dòng kho liên quan TRƯỚC khi ghi (chống 2 phiếu song song lệch tồn).
  PERFORM 1
  FROM public.products p
  WHERE p.sku IN (SELECT e->>'sku' FROM jsonb_array_elements(p_items) e)
  FOR UPDATE;

  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := x->>'sku';
    v_reason := btrim(COALESCE(x->>'reason', ''));
    v_note := NULLIF(btrim(COALESCE(x->>'note', '')), '');
    v_project_id := NULLIF(x->>'projectId', '')::UUID;
    v_ref := NULLIF(btrim(COALESCE(x->>'clientRef', '')), '');

    -- Chống ghi trùng: dòng này đã ghi rồi (bấm Ghi 2 lần / retry mạng) -> bỏ qua,
    -- KHÔNG trừ tồn và KHÔNG sinh thêm thẻ kho. Nhảy tới CONTINUE trước mọi thao tác ghi.
    IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM public.stock_adjustments WHERE client_ref = v_ref) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id, name, unit, product_type, stock_quantity, COALESCE(avg_cost, 0)
    INTO v_pid, v_name, v_unit, v_type, v_stock, v_avg
    FROM public.products p WHERE p.sku = v_sku;

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'SKU % không tồn tại trong danh mục', v_sku;
    END IF;
    IF v_type IN ('service', 'combo') THEN
      RAISE EXCEPTION '%: hàng dịch vụ/combo không có tồn để điều chỉnh', v_sku;
    END IF;
    IF v_reason = '' THEN
      RAISE EXCEPTION '%: thiếu lý do điều chỉnh tồn', v_sku;
    END IF;

    v_counted := CASE
      WHEN x ? 'countedStock' AND (x->>'countedStock')::NUMERIC >= 0 THEN (x->>'countedStock')::NUMERIC
      ELSE NULL
    END;
    v_delta_given := COALESCE((x->>'delta')::NUMERIC, 0);

    -- Tồn thực tế âm: báo đúng nguyên nhân thay vì rơi xuống nhánh "chưa nhập gì" —
    -- đây là lỗi nhập liệu của người dùng, cần nói rõ chứ không nói chung chung.
    IF x ? 'countedStock' AND (x->>'countedStock')::NUMERIC < 0 THEN
      RAISE EXCEPTION '%: tồn thực tế không thể âm (đã nhập %)', v_sku, x->>'countedStock';
    END IF;

    IF v_counted IS NOT NULL THEN
      v_delta := v_counted - v_stock;
    ELSIF v_delta_given <> 0 THEN
      v_delta := v_delta_given;
    ELSE
      RAISE EXCEPTION '%: chưa nhập tồn thực tế hoặc chênh lệch', v_sku;
    END IF;

    -- Phiếu không làm thay đổi gì thì KHÔNG ghi. Ghi phiếu 0 đơn vị là rác: vẫn sinh
    -- thẻ kho + dòng audit mà tồn không đổi, làm sổ điều chỉnh khó đọc và gây hiểu nhầm.
    IF v_delta = 0 THEN
      RAISE EXCEPTION '%: tồn thực tế khớp hệ thống, không có gì để điều chỉnh', v_sku;
    END IF;

    v_new := v_stock + v_delta;
    IF v_new < 0 THEN
      RAISE EXCEPTION '%: điều chỉnh sẽ làm tồn âm (tồn % %, muốn để %)',
        v_sku, v_stock, v_unit, v_new;
    END IF;

    IF v_project_id IS NOT NULL THEN
      SELECT code INTO v_project_code FROM public.projects WHERE id = v_project_id;
      IF v_project_code IS NULL THEN
        RAISE EXCEPTION '%: công trình không tồn tại', v_sku;
      END IF;
      -- Hao hụt (mất hàng) mới gắn công trình; đếm thừa thì đích là kho.
      IF v_delta >= 0 THEN
        v_project_id := NULL;
        v_project_code := NULL;
      END IF;
    END IF;

    UPDATE public.products SET stock_quantity = v_new WHERE id = v_pid;

    -- Thẻ kho: movement_type 'adjust_loss' (hao hụt) hoặc 'adjust_gain' (đếm thừa).
    INSERT INTO public.stock_movements
      (reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type)
    VALUES (
      v_code, v_pid, v_delta, v_stock, v_new,
      'Điều chỉnh tồn: ' || v_reason
        || CASE WHEN v_project_code IS NOT NULL THEN ' — hao hụt công trình ' || v_project_code
                ELSE ' — kho' END,
      CASE WHEN v_delta < 0 THEN 'adjust_loss' ELSE 'adjust_gain' END
    );

    INSERT INTO public.stock_adjustments
      (code, client_ref, product_id, sku, previous_stock, counted_stock, delta, reason, note,
       project_id, unit_cost, loss_amount, adjusted_by, adjusted_by_name)
    VALUES (
      v_code, v_ref, v_pid, v_sku, v_stock, v_counted, v_delta, v_reason, v_note,
      v_project_id, round(v_avg, 2),
      CASE WHEN v_delta < 0 THEN round(-v_delta * v_avg, 2) ELSE 0 END,
      auth.uid(), v_actor_name
    )
    RETURNING id INTO v_adj_id;

    -- Gắn công trình: ghi thêm DÒNG ĐIỀU CHỈNH vào project_materials để P&L công
    -- trình tự giảm (recalcProjectTotals cộng hết dòng). KHÔNG trừ kho ở đây — tồn đã
    -- trừ đúng một lần ở trên, trừ hai lần là sai.
    IF v_project_id IS NOT NULL AND v_delta < 0 THEN
      INSERT INTO public.project_materials
        (project_id, product_id, sku, name, unit, quantity, unit_cost, is_adjust, note, created_at, adjust_id)
      VALUES (
        v_project_id, v_pid, v_sku, v_name, v_unit, -v_delta, round(v_avg, 2),
        true, 'Hao hụt: ' || v_reason || CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END,
        now(), v_adj_id
      );
    END IF;

    IF v_delta < 0 THEN
      v_loss_total := v_loss_total + round(-v_delta * v_avg, 2);
    END IF;
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Cả 2 vế bằng 0 = mọi dòng đã ghi trước đó (bấm Ghi 2 lần) -> coi như idempotent OK.
  IF v_inserted = 0 AND v_skipped = 0 THEN
    RAISE EXCEPTION 'Phiếu không còn dòng nào để ghi';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_code,
    'adjusted', v_inserted,
    'skipped', v_skipped,
    'loss_amount', v_loss_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_stock(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_stock(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(TEXT, JSONB) TO authenticated;
