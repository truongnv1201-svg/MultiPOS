-- Migration 62 — XOÁ cột orders.cash_rounding (dữ liệu bán hàng hiện là thử nghiệm).
--
-- 0061 đã gỡ chức năng làm tròn tiền mặt nhưng còn giữ cột cho lịch sử. Nay chủ đầu tư xác nhận
-- toàn bộ dữ liệu bán hiện tại chỉ là thử nghiệm -> xoá hẳn cột cho sạch schema.
--
-- Thứ tự (quan trọng): thay HAI hàm trước để không còn tham chiếu cột, rồi mới drop cột.
-- 1) checkout_order: bỏ biến v_cash_rounding và cột trong câu UPDATE orders. Số học
--    không đổi: từ 0061 cash_rounding luôn = 0 nên (A - 0) == A, viết gọn lại là A.
-- 2) pos_checkout: bỏ khoá 'cash_rounding' khỏi 3 chỗ jsonb_build_object trả về.
--    Client (lib/pricing.ts, store) đã bỏ trường cash_rounding ở cùng đợt.
-- 3) drop cột.
--
-- Không đổi chữ ký hàm nào -> tương thích call cũ.

-- 1) checkout_order: bỏ hoàn toàn làm tròn
CREATE OR REPLACE FUNCTION public.checkout_order(
  p_order_id UUID,
  p_discount DECIMAL,
  p_payments JSONB,
  p_note TEXT,
  p_vat_percent NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_line_total DECIMAL(12,2) := 0;
  v_payable DECIMAL(12,2) := 0;
  v_vat_pct NUMERIC := GREATEST(COALESCE(p_vat_percent, 0), 0);
  v_vat DECIMAL(12,2) := 0;
  v_total_paid DECIMAL(12,2) := 0;
  v_change_amount DECIMAL(12,2) := 0;
  v_debt DECIMAL(12,2) := 0;
  v_paid_allocated DECIMAL(12,2) := 0;
  v_code TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Đơn hàng không tồn tại hoặc đã hoàn tất';
  END IF;

  -- Tính lại dòng area từ JSONB — TIỀN LÀM TRÒN NGUYÊN + VẬT TƯ TIÊU HAO TỰ TÍNH
  UPDATE order_items oi
  SET processing_fee = CASE
      WHEN oi.item_type = 'area' AND oi.dimension_details IS NOT NULL THEN
        COALESCE((SELECT SUM((x->>'processing_fee')::DECIMAL)
          FROM jsonb_array_elements(oi.dimension_details) x), 0)
      ELSE oi.processing_fee
    END,
    subtotal = CASE
      WHEN oi.item_type = 'area' AND oi.dimension_details IS NOT NULL THEN
        round(
          COALESCE((SELECT SUM((x->>'actual_m2')::DECIMAL)
            FROM jsonb_array_elements(oi.dimension_details) x), oi.quantity)
          * oi.unit_price
          + COALESCE((SELECT SUM((x->>'processing_fee')::DECIMAL)
            FROM jsonb_array_elements(oi.dimension_details) x), 0), 0)
      ELSE
        round(oi.quantity * oi.unit_price + COALESCE(oi.processing_fee, 0), 0)
    END,
    -- P0-1: vật tư tiêu hao server tự tính, không tin client
    material_consumed = CASE
      WHEN oi.item_type = 'area' AND oi.dimension_details IS NOT NULL THEN
        round(
          COALESCE((SELECT SUM((x->>'actual_m2')::DECIMAL)
            FROM jsonb_array_elements(oi.dimension_details) x), oi.quantity)
          * (1 + COALESCE(oi.waste_factor, 0) / 100), 3)
      WHEN oi.item_type IN ('goods') THEN oi.quantity
      ELSE oi.material_consumed
    END
  WHERE oi.order_id = p_order_id;

  -- Tiền hàng sau CK dòng (thuần, chưa ship, chưa VAT)
  SELECT COALESCE(SUM(subtotal - COALESCE(discount_amount, 0)), 0) INTO v_line_total
  FROM order_items WHERE order_id = p_order_id;
  v_payable := v_line_total + COALESCE(v_order.shipping_fee, 0);

  IF v_vat_pct > 0 THEN
    v_vat := round(GREATEST(v_line_total - p_discount, 0) * v_vat_pct / 100, 0);
  ELSE
    v_vat := 0;
  END IF;

  SELECT COALESCE(SUM((x->>'amount')::DECIMAL), 0) INTO v_total_paid
  FROM jsonb_array_elements(p_payments) AS x;

  IF v_total_paid > (v_payable + v_vat - p_discount) THEN
    v_change_amount := v_total_paid - (v_payable + v_vat - p_discount);
    v_paid_allocated := v_payable + v_vat - p_discount;
    v_debt := 0;
  ELSE
    v_paid_allocated := v_total_paid;
    v_debt := round((v_payable + v_vat - p_discount) - v_total_paid, 0);
  END IF;

  UPDATE orders
  SET status = 'completed',
      subtotal = v_line_total,
      discount_amount = p_discount,
      vat_amount = v_vat,
      vat_percent = v_vat_pct,
      total_amount = v_payable + v_vat - p_discount,
      paid_amount = paid_amount + v_paid_allocated,
      debt_amount = v_debt,
      note = COALESCE(p_note, note),
      updated_at = NOW()
  WHERE id = p_order_id RETURNING order_code INTO v_code;

  PERFORM consume_stock_for_order(p_order_id);

  IF v_debt > 0 AND v_order.customer_id IS NOT NULL THEN
    UPDATE customers SET current_debt = current_debt + v_debt WHERE id = v_order.customer_id;
  END IF;

  INSERT INTO cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
  SELECT generate_order_code('PT'),
    'receipt',
    CASE WHEN (x->>'method') = 'cash' THEN 'cash' ELSE 'bank' END,
    'sales', (x->>'amount')::DECIMAL, v_code, 'Checkout ' || v_code
  FROM jsonb_array_elements(p_payments) x
  WHERE (x->>'method') NOT IN ('debt','points') AND (x->>'amount')::DECIMAL > 0;

  RETURN jsonb_build_object('ok', true, 'order_code', v_code, 'change_amount', v_change_amount,
    'vat_amount', v_vat, 'vat_percent', v_vat_pct);
END;
$$;

-- 2) pos_checkout: không trả cash_rounding nữa
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
          'ok', true, 'duplicate', true, 'order_id', o.id, 'order_code', o.code,
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

REVOKE EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT) TO authenticated;

-- 3) drop cột (không còn hàm nào tham chiếu)
ALTER TABLE public.orders DROP COLUMN IF EXISTS cash_rounding;

NOTIFY pgrst, 'reload schema';
