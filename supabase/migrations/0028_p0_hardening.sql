-- Migration 28 — P0 hardening (rà soát 2026-09-22)
-- 1) checkout_order tự tính lại material_consumed từ dimension_details + waste (khỏi tin client).
--    Trước đây UPDATE chỉ recompute subtotal/processing_fee, consume_stock dùng material_consumed
--    client gửi -> gửi waste=0 là trừ thiếu kho.
-- 2) pos_checkout dùng waste_factor server (products.waste_factor) để tính v_mat, không tin client.
-- 3) Chặn combo chứa area/service ngay khi checkout (BOM combo chỉ được goods).
-- 4) Khóa anon checkout: pos_checkout chỉ authenticated (client đã bắt login khi online).
--    Trước đây GRANT anon -> gọi trực tiếp với đơn giá 1đ được.
-- Không đổi chữ ký hàm -> tương thích call cũ.

-- 1) checkout_order: recompute material_consumed server-side
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
  v_cash_rounding DECIMAL(8,2) := 0;
  v_rounding_denom INTEGER := 500;
  v_round_base DECIMAL(12,2) := 0;
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

  SELECT COALESCE((value->>'denominator')::INTEGER, 500)
  INTO v_rounding_denom FROM settings WHERE key = 'cash_rounding';

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_payments) AS x(method text)
             WHERE x.method = 'cash') THEN
    v_round_base := GREATEST(v_payable + v_vat - p_discount, 0);
    v_cash_rounding := v_round_base % v_rounding_denom;
  ELSE
    v_cash_rounding := 0;
  END IF;

  SELECT COALESCE(SUM((x->>'amount')::DECIMAL), 0) INTO v_total_paid
  FROM jsonb_array_elements(p_payments) AS x;

  IF v_total_paid > (v_payable + v_vat - p_discount - v_cash_rounding) THEN
    v_change_amount := v_total_paid - (v_payable + v_vat - p_discount - v_cash_rounding);
    v_paid_allocated := v_payable + v_vat - p_discount - v_cash_rounding;
    v_debt := 0;
  ELSE
    v_paid_allocated := v_total_paid;
    v_debt := round((v_payable + v_vat - p_discount - v_cash_rounding) - v_total_paid, 0);
  END IF;

  UPDATE orders
  SET status = 'completed',
      subtotal = v_line_total,
      discount_amount = p_discount,
      vat_amount = v_vat,
      vat_percent = v_vat_pct,
      cash_rounding = v_cash_rounding,
      total_amount = v_payable + v_vat - p_discount - v_cash_rounding,
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

-- 2)+3) pos_checkout: waste server + chặn combo area/service + giữ chữ ký 9-arg
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_customer_name TEXT,
  p_items JSONB,
  p_discount NUMERIC DEFAULT 0,
  p_payments JSONB DEFAULT '[]'::JSONB,
  p_note TEXT DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT 0,
  p_is_deposit BOOLEAN DEFAULT FALSE,
  p_customer_id UUID DEFAULT NULL,
  p_vat_percent NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_code TEXT;
  r JSONB;
  it JSONB;
  v_pid UUID;
  v_waste NUMERIC;
  v_mat NUMERIC;
  v_m2 NUMERIC;
  v_debt NUMERIC;
  v_ptype TEXT;
  v_child_type TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Giỏ hàng trống';
  END IF;

  v_code := public.generate_order_code('HD');
  INSERT INTO public.orders (order_code, customer_id, customer_name, status, shipping_fee, note)
  VALUES (v_code, p_customer_id, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'),
    'pending', COALESCE(p_shipping_fee, 0), p_note)
  RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, product_type, COALESCE(waste_factor, 0) INTO v_pid, v_ptype, v_waste
    FROM public.products WHERE sku = (it->>'sku');
    -- P0-5: combo chỉ được chứa goods — chặn sớm để khỏi trừ sai đơn vị kho
    IF COALESCE(it->>'item_type', 'goods') = 'combo' THEN
      IF v_pid IS NULL THEN
        RAISE EXCEPTION 'SKU combo không tồn tại: %', (it->>'sku');
      END IF;
      SELECT string_agg(p.product_type, ',') INTO v_child_type
      FROM public.combo_items ci JOIN public.products p ON p.id = ci.child_product_id
      WHERE ci.combo_product_id = v_pid
        AND p.product_type IN ('area', 'service');
      IF v_child_type IS NOT NULL THEN
        RAISE EXCEPTION 'Combo % chứa hàng area/service — BOM combo chỉ được hàng hóa', (it->>'sku');
      END IF;
    END IF;
    IF (it->>'item_type') = 'area' AND (it->'dimension_details') IS NOT NULL THEN
      SELECT COALESCE(SUM((x->>'actual_m2')::NUMERIC), (it->>'quantity')::NUMERIC)
        INTO v_m2 FROM jsonb_array_elements(it->'dimension_details') x;
      -- P0-1: dùng waste server, bỏ qua waste client gửi lên
      v_mat := v_m2 * (1 + COALESCE(v_waste, 0) / 100);
    ELSE
      v_mat := (it->>'quantity')::NUMERIC;
    END IF;
    INSERT INTO public.order_items
      (order_id, product_id, sku, name, item_type, unit, quantity, unit_price,
       discount_amount, processing_fee, subtotal, dimension_details, waste_factor, material_consumed)
    VALUES
      (v_id, v_pid, it->>'sku', it->>'name',
       COALESCE(it->>'item_type', 'goods'), COALESCE(it->>'unit', 'cái'),
       (it->>'quantity')::NUMERIC, (it->>'unit_price')::NUMERIC,
       COALESCE((it->>'discount_amount')::NUMERIC, 0),
       COALESCE((it->>'processing_fee')::NUMERIC, 0), 0,
       CASE WHEN (it->'dimension_details') IS NOT NULL THEN (it->'dimension_details') ELSE NULL END,
       COALESCE(v_waste, 0), v_mat);
  END LOOP;

  r := public.checkout_order(v_id, COALESCE(p_discount, 0), COALESCE(p_payments, '[]'::JSONB),
    p_note, COALESCE(p_vat_percent, 0));

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

-- 4) Khóa anon checkout (P0-4): client online đã bắt login, RPC không còn cho anon gọi trực tiếp
REVOKE EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC) TO authenticated;
