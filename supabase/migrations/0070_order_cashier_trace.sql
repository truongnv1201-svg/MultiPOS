-- Migration 70 — Ghi dấu vết thu ngân lên đơn (ai bán).
-- Bối cảnh: pos_checkout không lưu cashier_id nên mọi đơn pull về đều hiện
-- "Thu ngân: Nhân viên", kể cả đơn chính mình vừa bán. Giờ ghi cashier_id =
-- auth.uid() + cashier_name (tên profile) ngay lúc tạo đơn; client hiển thị
-- tên thật, đơn cũ (NULL) giữ cách hiển thị cũ. Body copy y hệt 0062, chỉ thêm
-- 2 cột ở INSERT.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cashier_name TEXT;

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
  v_ovr NUMERIC;
  v_overridden BOOLEAN;
  v_override_by TEXT;
  v_sent_price NUMERIC;
  v_price_adjusted JSONB;
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
  v_price_adjusted := '[]'::JSONB;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Giỏ hàng trống';
  END IF;

  -- Kẹp đầu vào bill-level (chặn payable âm / VAT lạ)
  v_bill_disc := GREATEST(COALESCE(p_discount, 0), 0);
  v_ship := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_vat := COALESCE(p_vat_percent, 0);
  IF v_vat NOT IN (0, 5, 8, 10) THEN
    RAISE EXCEPTION 'VAT % không hợp lệ (chỉ chấp nhận 0/5/8/10)', v_vat;
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
          'ok', true, 'duplicate', true, 'order_id', o.id, 'order_code', o.order_code,
          'change_amount', 0,
          'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
          'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
          'total_amount', o.total_amount,
          'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
        FROM public.orders o WHERE o.id = v_dup.id);
    END IF;
  END IF;

  v_code := public.generate_order_code('HD');
  -- Bọc unique_violation cho đường retry song song (TOCTOU): bên thua trả duplicate.
  BEGIN
    INSERT INTO public.orders (order_code, customer_id, customer_name, status, shipping_fee, note, client_ref, cashier_id, cashier_name)
    VALUES (v_code, p_customer_id, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'),
      'pending', v_ship, p_note,
      NULLIF(p_client_ref, ''),
      auth.uid(),
      (SELECT NULLIF(BTRIM(full_name), '') FROM public.profiles WHERE id = auth.uid()))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_dup FROM public.orders WHERE client_ref = p_client_ref;
    IF FOUND THEN
      RETURN (SELECT jsonb_build_object(
          'ok', true, 'duplicate', true, 'order_id', o.id, 'order_code', o.order_code,
          'change_amount', 0,
          'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
          'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
          'total_amount', o.total_amount,
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
    -- 0059: ghi đè đơn giá cho riêng đơn này (UI cho người dùng sửa trước khi bán).
    -- Server tự gate quyền: thu ngân gửi lên -> RAISE, không tin giá client.
    v_overridden := false;
    v_override_by := NULL;
    IF (it->'price_override') IS NOT NULL AND jsonb_typeof(it->'price_override') <> 'null' THEN
      -- is_manager() đã gồm cả admin (0012:12-15)
      IF NOT public.is_manager() THEN
        RAISE EXCEPTION 'Chỉ Quản lý/Admin được sửa đơn giá (SKU %)', (it->>'sku');
      END IF;
      v_ovr := COALESCE((it->>'price_override')::NUMERIC, 0);
      IF v_ovr < 0 OR v_ovr > 100000000 THEN
        RAISE EXCEPTION 'Đơn giá không hợp lệ (SKU %)', (it->>'sku');
      END IF;
      -- Gõ lại đúng giá danh mục thì không ghi dấu vết (so sánh sau làm tròn).
      IF round(v_ovr) <> round(v_price) THEN
        v_price := round(v_ovr);
        v_overridden := true;
        v_override_by := COALESCE(auth.uid()::TEXT, 'unknown')
          || COALESCE(' ' || (auth.jwt() ->> 'email'), '');
      END IF;
    END IF;

    -- 0060: so GIÁ THỰC TẾ với giá client gửi -> báo lại để app không in phiếu sai
    v_sent_price := round(COALESCE((it->>'unit_price')::NUMERIC, v_price));
    IF round(v_price) <> v_sent_price THEN
      v_price_adjusted := v_price_adjusted || jsonb_build_array(jsonb_build_object(
        'sku', it->>'sku', 'name', v_pname,
        'sent_price', v_sent_price, 'server_price', round(v_price),
        'overridden', v_overridden));
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
         discount_amount, processing_fee, subtotal, dimension_details, waste_factor, material_consumed,
         price_override, price_override_by)
      VALUES
        (v_id, v_pid, it->>'sku', v_pname,
         v_ptype, v_punit,
         v_qty, v_price,
         v_disc,
         v_fee, 0,
         v_new_elems,
         COALESCE(v_waste, 0), v_mat,
         v_overridden, v_override_by);
    ELSE
      v_mat := v_qty;
      v_fee := GREATEST(0, LEAST(100000000, COALESCE((it->>'processing_fee')::NUMERIC, 0)));
      v_line_cap := v_qty * v_price + v_fee;
      v_disc := LEAST(v_disc, GREATEST(v_line_cap, 0));
      INSERT INTO public.order_items
        (order_id, product_id, sku, name, item_type, unit, quantity, unit_price,
         discount_amount, processing_fee, subtotal, dimension_details, waste_factor, material_consumed,
         price_override, price_override_by)
      VALUES
        (v_id, v_pid, it->>'sku', v_pname,
         v_ptype, v_punit,
         v_qty, v_price,
         v_disc,
         v_fee, 0,
         CASE WHEN (it->'dimension_details') IS NOT NULL THEN (it->'dimension_details') ELSE NULL END,
         COALESCE(v_waste, 0), v_mat,
         v_overridden, v_override_by);
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
      'total_amount', o.total_amount,
      'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status,
      -- 0060: [] = giá lưu đúng như màn hình; khác rỗng = có dòng bị đổi giá, app phải báo
      'price_adjusted', v_price_adjusted)
    FROM public.orders o WHERE o.id = v_id);
END;
$$;
