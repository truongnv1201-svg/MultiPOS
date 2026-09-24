-- Migration 50 — Server price authority cho pos_checkout (P0 thương mại).
-- Vấn đề: pos_checkout tin unit_price/discount/processing_fee/item_type do client gửi
-- (0043:102-112 insert trực tiếp từ JSON). Tài khoản authenticated có thể gọi RPC với
-- unit_price=1 để mua giá 1đ, hoặc đẩy discount_amount khổng lồ để payable âm.
-- Thiết kế (tương thích call cũ — không đổi chữ ký 10-arg):
-- 1) Đơn giá + tên + đvt + loại hàng + waste lấy từ products theo SKU (server truth).
--    SKU không tồn tại -> RAISE (mọi mặt hàng bán qua POS đều phải có trong catalog).
-- 2) CK dòng kẹp [0, tiền dòng]; CK bill kẹp >= 0; ship >= 0; VAT allowlist (0/5/8/10);
--    quantity (0, 100000]; payments amount >= 0.
-- 3) Hàng area: rebuild processing_fee từng tấm từ grinding_services server +
--    lỗ 25k + góc 15k (khớp HOLE_PRICE/CORNER_PRICE ở lib/mock-data.ts) +
--    extra_fee kẹp [0, 20tr]; actual_m2 (0, 1000], perimeter [0, 500].
--    (checkout_order 0028 đã SUM lại fee từ dimension_details nên fee rebuild tự chảy qua.)
-- 4) Idempotency chống TOCTOU: giữ check sớm + bọc INSERT orders trong EXCEPTION
--    unique_violation -> 2 retry song song cùng client_ref thì bên thua trả
--    duplicate:true thay vì 500.
-- 5) consume_stock_for_order: khóa FOR UPDATE toàn bộ dòng kho liên quan trước khi trừ
--    để 2 checkout cùng SKU không lọt khe âm kho thoáng qua.

-- 5) Khóa kho trước khi trừ (sửa TOCTOU trừ kho song song)
CREATE OR REPLACE FUNCTION public.consume_stock_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  r record;
begin
  -- Khóa mọi dòng kho sẽ chạm tới (hàng thường/biến thể/linh kiện combo) để
  -- transaction thứ 2 phải đợi transaction đầu commit/rollback rồi mới check âm.
  PERFORM 1 FROM public.products p
    WHERE p.id IN (SELECT oi.product_id FROM public.order_items oi
      WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL)
    FOR UPDATE;
  PERFORM 1 FROM public.product_variants v
    WHERE v.id IN (SELECT oi.product_variant_id FROM public.order_items oi
      WHERE oi.order_id = p_order_id AND oi.product_variant_id IS NOT NULL)
    FOR UPDATE;
  PERFORM 1 FROM public.products p
    WHERE p.id IN (SELECT ci.child_product_id FROM public.order_items oi
      JOIN public.combo_items ci ON ci.combo_product_id = oi.product_id
      WHERE oi.order_id = p_order_id AND oi.item_type = 'combo')
    FOR UPDATE;

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

-- 1)+2)+3)+4) pos_checkout với server price authority
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_customer_name TEXT,
  p_items JSONB,
  p_discount NUMERIC DEFAULT 0,
  p_payments JSONB DEFAULT '[]'::JSONB,
  p_note TEXT DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT 0,
  p_is_deposit BOOLEAN DEFAULT FALSE,
  p_customer_id UUID DEFAULT NULL,
  p_vat_percent NUMERIC DEFAULT 0,
  p_client_ref TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_code TEXT;
  r JSONB;
  it JSONB;
  x JSONB;
  v_pid UUID;
  v_ptype TEXT;
  v_pname TEXT;
  v_punit TEXT;
  v_waste NUMERIC;
  v_price NUMERIC;
  v_qty NUMERIC;
  v_disc NUMERIC;
  v_fee NUMERIC;
  v_line_cap NUMERIC;
  v_mat NUMERIC;
  v_m2 NUMERIC;
  v_m2e NUMERIC;
  v_perim NUMERIC;
  v_gprice NUMERIC;
  v_holes INT;
  v_corners INT;
  v_extra NUMERIC;
  v_elem_fee NUMERIC;
  v_new_elems JSONB;
  v_ship NUMERIC;
  v_bill_disc NUMERIC;
  v_vat NUMERIC;
  v_pm JSONB;
  v_debt NUMERIC;
  v_child_type TEXT;
  v_dup RECORD;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Giỏ hàng trống';
  END IF;

  -- Kẹp đầu vào bill-level (chặn payable âm / VAT lạ)
  v_bill_disc := GREATEST(COALESCE(p_discount, 0), 0);
  v_ship := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_vat := COALESCE(p_vat_percent, 0);
  IF v_vat NOT IN (0, 5, 8, 10) THEN
    RAISE EXCEPTION 'VAT % không hợp lệ (chỉ chấp nhận 0/5/8/10): %', v_vat;
  END IF;
  FOR v_pm IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments, '[]'::JSONB)) LOOP
    IF COALESCE((v_pm->>'amount')::NUMERIC, -1) < 0 THEN
      RAISE EXCEPTION 'Số tiền thanh toán không hợp lệ';
    END IF;
  END LOOP;

  -- Idempotency (check sớm cho đường retry tuần tự)
  IF p_client_ref IS NOT NULL AND p_client_ref <> '' THEN
    SELECT * INTO v_dup FROM public.orders WHERE client_ref = p_client_ref;
    IF FOUND THEN
      RETURN (SELECT jsonb_build_object(
          'ok', true, 'duplicate', true, 'order_id', o.id, 'order_code', o.code,
          'change_amount', 0,
          'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
          'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
          'cash_rounding', o.cash_rounding, 'total_amount', o.total_amount,
          'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
        FROM public.orders o WHERE o.id = v_dup.id);
    END IF;
  END IF;

  v_code := public.generate_order_code('HD');
  -- Bọc unique_violation cho đường retry song song (TOCTOU): bên thua trả duplicate.
  BEGIN
    INSERT INTO public.orders (order_code, customer_id, customer_name, status, shipping_fee, note, client_ref)
    VALUES (v_code, p_customer_id, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'),
      'pending', v_ship, p_note,
      NULLIF(p_client_ref, ''))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_dup FROM public.orders WHERE client_ref = p_client_ref;
    IF FOUND THEN
      RETURN (SELECT jsonb_build_object(
          'ok', true, 'duplicate', true, 'order_id', o.id, 'order_code', o.code,
          'change_amount', 0,
          'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
          'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
          'cash_rounding', o.cash_rounding, 'total_amount', o.total_amount,
          'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
        FROM public.orders o WHERE o.id = v_dup.id);
    END IF;
    RAISE;
  END;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((it->>'quantity')::NUMERIC, 0);
    IF v_qty <= 0 OR v_qty > 100000 THEN
      RAISE EXCEPTION 'Số lượng không hợp lệ (SKU %)', (it->>'sku');
    END IF;
    -- Server truth theo SKU: giá/tên/đvt/loại/waste. SKU lạ -> từ chối.
    SELECT p.id, p.product_type, p.name, p.unit, COALESCE(p.waste_factor, 0), p.retail_price
      INTO v_pid, v_ptype, v_pname, v_punit, v_waste, v_price
      FROM public.products p WHERE p.sku = (it->>'sku');
    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'SKU không tồn tại trong catalog: %', (it->>'sku');
    END IF;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Giá bán SKU % chưa cấu hình', (it->>'sku');
    END IF;
    -- P0-5: combo chỉ được chứa goods — chặn sớm để khỏi trừ sai đơn vị kho
    IF v_ptype = 'combo' THEN
      SELECT string_agg(p.product_type, ',') INTO v_child_type
      FROM public.combo_items ci JOIN public.products p ON p.id = ci.child_product_id
      WHERE ci.combo_product_id = v_pid
        AND p.product_type IN ('area', 'service');
      IF v_child_type IS NOT NULL THEN
        RAISE EXCEPTION 'Combo % chứa hàng area/service — BOM combo chỉ được hàng hóa', (it->>'sku');
      END IF;
    END IF;
    v_disc := GREATEST(COALESCE((it->>'discount_amount')::NUMERIC, 0), 0);
    IF v_ptype = 'area' AND (it->'dimension_details') IS NOT NULL
      AND jsonb_typeof(it->'dimension_details') = 'array' THEN
      -- Rebuild fee từng tấm từ bảng giá mài server (khỏi tin fee client)
      v_new_elems := '[]'::JSONB;
      v_m2 := 0;
      FOR x IN SELECT * FROM jsonb_array_elements(it->'dimension_details') LOOP
        v_m2e := COALESCE((x->>'actual_m2')::NUMERIC, 0);
        IF v_m2e <= 0 OR v_m2e > 1000 THEN
          RAISE EXCEPTION 'Diện tích tấm không hợp lệ (SKU %)', (it->>'sku');
        END IF;
        v_perim := COALESCE((x->>'perimeter_md')::NUMERIC, 0);
        IF v_perim < 0 OR v_perim > 500 THEN
          RAISE EXCEPTION 'Chu vi mài không hợp lệ (SKU %)', (it->>'sku');
        END IF;
        SELECT COALESCE(price_per_md, 0) INTO v_gprice
          FROM public.grinding_services WHERE id = COALESCE(x->>'grinding_type', 'none');
        v_gprice := COALESCE(v_gprice, 0);
        v_holes := GREATEST(0, LEAST(1000, COALESCE((x->>'holes')::INT, 0)));
        v_corners := GREATEST(0, LEAST(1000, COALESCE((x->>'corners')::INT, 0)));
        v_extra := GREATEST(0, LEAST(20000000, COALESCE((x->>'extra_fee')::NUMERIC, 0)));
        v_elem_fee := round(COALESCE(v_perim, 0) * v_gprice)
          + v_holes * 25000 + v_corners * 15000 + v_extra;
        v_new_elems := v_new_elems || jsonb_build_array(
          x || jsonb_build_object('processing_fee', v_elem_fee));
        v_m2 := v_m2 + v_m2e;
      END LOOP;
      IF v_m2 <= 0 THEN
        RAISE EXCEPTION 'Hàng đo thiếu diện tích (SKU %)', (it->>'sku');
      END IF;
      v_mat := v_m2 * (1 + COALESCE(v_waste, 0) / 100);
      v_line_cap := v_m2 * v_price + COALESCE(
        (SELECT SUM((e->>'processing_fee')::NUMERIC) FROM jsonb_array_elements(v_new_elems) e), 0);
      v_disc := LEAST(v_disc, GREATEST(v_line_cap, 0));
      v_fee := 0; -- fee nằm trong từng tấm, checkout_order SUM từ JSONB
      INSERT INTO public.order_items
        (order_id, product_id, sku, name, item_type, unit, quantity, unit_price,
         discount_amount, processing_fee, subtotal, dimension_details, waste_factor, material_consumed)
      VALUES
        (v_id, v_pid, it->>'sku', v_pname,
         v_ptype, v_punit,
         v_qty, v_price,
         v_disc,
         v_fee, 0,
         v_new_elems,
         COALESCE(v_waste, 0), v_mat);
    ELSE
      v_mat := v_qty;
      v_fee := GREATEST(0, LEAST(100000000, COALESCE((it->>'processing_fee')::NUMERIC, 0)));
      v_line_cap := v_qty * v_price + v_fee;
      v_disc := LEAST(v_disc, GREATEST(v_line_cap, 0));
      INSERT INTO public.order_items
        (order_id, product_id, sku, name, item_type, unit, quantity, unit_price,
         discount_amount, processing_fee, subtotal, dimension_details, waste_factor, material_consumed)
      VALUES
        (v_id, v_pid, it->>'sku', v_pname,
         v_ptype, v_punit,
         v_qty, v_price,
         v_disc,
         v_fee, 0,
         CASE WHEN (it->'dimension_details') IS NOT NULL THEN (it->'dimension_details') ELSE NULL END,
         COALESCE(v_waste, 0), v_mat);
    END IF;
  END LOOP;

  r := public.checkout_order(v_id, v_bill_disc, COALESCE(p_payments, '[]'::JSONB),
    p_note, v_vat);

  SELECT debt_amount INTO v_debt FROM public.orders WHERE id = v_id;
  IF COALESCE(v_debt, 0) > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Bán nợ bắt buộc chọn khách hàng (server guard)';
  END IF;

  IF p_is_deposit THEN
    UPDATE public.orders SET status = 'deposit_order' WHERE id = v_id;
    UPDATE public.cashbook_entries SET category = 'deposit', note = 'Thu cọc đơn hàng ' || v_code
    WHERE reference_order_code = v_code AND category = 'sales';
  END IF;

  RETURN (SELECT jsonb_build_object(
      'ok', true, 'order_id', v_id, 'order_code', v_code,
      'change_amount', r->'change_amount',
      'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
      'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
      'cash_rounding', o.cash_rounding, 'total_amount', o.total_amount,
      'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
    FROM public.orders o WHERE o.id = v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
