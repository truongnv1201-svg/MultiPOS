-- Migration 28 — Guard tiền checkout + chốt quyền RPC (P1)
-- 1) Clamp server-side (defense in depth — client anon gửi discount/ship/vat tùy ý):
--    - p_discount kẹp [0, tiền hàng sau CK dòng]: trước đây payable đã GREATEST(...,0) nên
--      không âm, nhưng cột discount_amount lưu nguyên số thổi phồng -> receipt/báo cáo sai.
--      Nay v_disc clamp rồi dùng thống nhất cho VAT base, rounding base, chia paid/debt
--      và cột lưu. Khớp local lib/pricing.ts (P1 clamp cùng công thức).
--    - p_shipping_fee kẹp >= 0 (ship âm = tăng tiền cho khách).
--    - p_vat_percent kẹp [0,100].
--    Không đổi chữ ký -> tương thích call cũ; công thức total giữ nguyên 0027.
-- 2) Chốt GRANT sau mọi DROP overload (bài học 0024 quên grant gây 401):
--    pos_checkout(9-arg) + sync_customer cho anon,authenticated;
--    cancel_order / return_order_items(3-arg) / collect_debt chỉ authenticated.
--    File này idempotent — chạy lại an toàn.
-- 3) Thứ tự bắt buộc: 0024 -> 0025 -> 0026 -> 0028 (guard hủy/trả lặp + clamp tiền).
--    Môi trường còn kẹt HRM giữa 0014-0018: backup trước khi nhảy lên 0019+ (drop bảng cũ).
-- 4) Rate-limit anon (không làm được trong Postgres thuần): bật ở Supabase Dashboard
--    (Auth rate limit + PostgREST max-rows / WAF) và giám sát log pos_checkout/sync_customer
--    vì anon được SELECT catalog + EXECUTE 2 RPC này (chủ ý POS mở — xem 0007/0009).

-- 1) checkout_order bản clamp (5 args, giữ chữ ký 0023/0027)
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
  v_ship DECIMAL(12,2) := 0;
  v_disc DECIMAL(12,2) := 0;
  v_vat_pct NUMERIC := 0;
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

  -- Tính lại dòng area từ JSONB — TIỀN LÀM TRÒN NGUYÊN (khớp Math.round local, 0027)
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
    END
  WHERE oi.order_id = p_order_id;

  -- Tiền hàng sau CK dòng (thuần, chưa ship, chưa VAT) — cũng là orders.subtotal (0027)
  SELECT COALESCE(SUM(subtotal - COALESCE(discount_amount, 0)), 0) INTO v_line_total
  FROM order_items WHERE order_id = p_order_id;

  -- P1 clamp: CK bill [0, tiền hàng], ship >= 0, VAT% [0,100]
  v_disc := GREATEST(LEAST(COALESCE(p_discount, 0), v_line_total), 0);
  v_ship := GREATEST(COALESCE(v_order.shipping_fee, 0), 0);
  v_vat_pct := LEAST(GREATEST(COALESCE(p_vat_percent, 0), 0), 100);
  v_payable := v_line_total + v_ship;

  -- VAT trên (tiền hàng sau CK dòng - CK bill), KHÔNG gồm ship — round NGUYÊN (0027)
  IF v_vat_pct > 0 THEN
    v_vat := round(GREATEST(v_line_total - v_disc, 0) * v_vat_pct / 100, 0);
  ELSE
    v_vat := 0;
  END IF;

  SELECT COALESCE((value->>'denominator')::INTEGER, 500)
  INTO v_rounding_denom FROM settings WHERE key = 'cash_rounding';

  -- NEW-CONF-03: chỉ làm tròn khi có method='cash' (giữ nguyên), base cộng thêm VAT
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_payments) AS x(method text)
             WHERE x.method = 'cash') THEN
    v_round_base := GREATEST(v_payable + v_vat - v_disc, 0);
    v_cash_rounding := v_round_base % v_rounding_denom;
  ELSE
    v_cash_rounding := 0;
  END IF;

  SELECT COALESCE(SUM((x->>'amount')::DECIMAL), 0) INTO v_total_paid
  FROM jsonb_array_elements(p_payments) AS x;

  IF v_total_paid > (v_payable + v_vat - v_disc - v_cash_rounding) THEN
    v_change_amount := v_total_paid - (v_payable + v_vat - v_disc - v_cash_rounding);
    v_paid_allocated := v_payable + v_vat - v_disc - v_cash_rounding;
    v_debt := 0;
  ELSE
    v_paid_allocated := v_total_paid;
    v_debt := round((v_payable + v_vat - v_disc - v_cash_rounding) - v_total_paid, 0);
  END IF;

  UPDATE orders
  SET status = 'completed',
      subtotal = v_line_total,
      shipping_fee = v_ship,
      discount_amount = v_disc,
      vat_amount = v_vat,
      vat_percent = v_vat_pct,
      cash_rounding = v_cash_rounding,
      total_amount = v_payable + v_vat - v_disc - v_cash_rounding,
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

-- pos_checkout: kẹp đầu vào trước khi tạo đơn (ship >= 0; discount/vat truyền xuống
-- checkout_order sẽ clamp tiếp — idempotent). Giữ chữ ký 9-arg 0023.
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
  v_mat NUMERIC;
  v_m2 NUMERIC;
  v_debt NUMERIC;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Giỏ hàng trống';
  END IF;

  v_code := public.generate_order_code('HD');
  INSERT INTO public.orders (order_code, customer_id, customer_name, status, shipping_fee, note)
  VALUES (v_code, p_customer_id, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'),
    'pending', GREATEST(COALESCE(p_shipping_fee, 0), 0), p_note)
  RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id INTO v_pid FROM public.products WHERE sku = (it->>'sku');
    IF (it->>'item_type') = 'area' AND (it->'dimension_details') IS NOT NULL THEN
      SELECT COALESCE(SUM((x->>'actual_m2')::NUMERIC), (it->>'quantity')::NUMERIC)
        INTO v_m2 FROM jsonb_array_elements(it->'dimension_details') x;
      v_mat := v_m2 * (1 + COALESCE((it->>'waste_factor')::NUMERIC, 0) / 100);
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
       GREATEST(COALESCE((it->>'discount_amount')::NUMERIC, 0), 0),
       GREATEST(COALESCE((it->>'processing_fee')::NUMERIC, 0), 0), 0,
       CASE WHEN (it->'dimension_details') IS NOT NULL THEN (it->'dimension_details') ELSE NULL END,
       COALESCE((it->>'waste_factor')::NUMERIC, 0), v_mat);
  END LOOP;

  r := public.checkout_order(v_id, GREATEST(COALESCE(p_discount, 0), 0),
    COALESCE(p_payments, '[]'::JSONB), p_note,
    LEAST(GREATEST(COALESCE(p_vat_percent, 0), 0), 100));

  SELECT debt_amount INTO v_debt FROM public.orders WHERE id = v_id;
  -- Server guard 0009: nợ > 0 bắt buộc có chủ (RAISE -> rollback toàn bộ)
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

-- 2) Chốt quyền (idempotent — chạy lại an toàn, vá lớp DROP-mất-quyền)
GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_customer(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_debt(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
