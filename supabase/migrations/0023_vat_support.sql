-- Migration 23 — VAT tính riêng ở server (thay cách client gộp VAT vào p_shipping_fee)
-- Bối cảnh: calculatedTotals local tính VAT% trên (tiền hàng sau CK dòng - CK bill), không gồm ship.
-- Server 0003/0007/0009 không có khái niệm VAT -> đơn có VAT bị lệch preview vs receipt.
-- 1) orders thêm vat_amount / vat_percent (báo cáo thuế đọc trực tiếp, khỏi suy ngược)
-- 2) checkout_order thêm p_vat_percent (cuối + DEFAULT -> call 4-arg cũ vẫn chạy, vat=0)
--    v_vat = round(GREATEST(line_total - p_discount, 0) * pct / 100, 2) — khớp local từng đồng
--    total = line_total + ship + vat - discount - rounding (rounding cũng cộng vat vào base,
--    và GREATEST(...,0) để khớp local khi CK vượt tiền hàng)
-- 3) pos_checkout thêm p_vat_percent, truyền xuống checkout_order, trả về vat_amount/vat_percent
-- 4) Drop overload cũ để PostgREST hết ambiguous PGRST203 (theo mẫu 0009)

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS vat_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- 2) checkout_order bản VAT (5 args)
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

  -- Tính lại dòng area từ JSONB (giữ nguyên logic 0007)
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
            FROM jsonb_array_elements(oi.dimension_details) x), 0), 2)
      ELSE
        round(oi.quantity * oi.unit_price + COALESCE(oi.processing_fee, 0), 2)
    END
  WHERE oi.order_id = p_order_id;

  -- Tiền hàng sau CK dòng (chưa ship, chưa VAT)
  SELECT COALESCE(SUM(subtotal - COALESCE(discount_amount, 0)), 0) INTO v_line_total
  FROM order_items WHERE order_id = p_order_id;
  v_payable := v_line_total + COALESCE(v_order.shipping_fee, 0);

  -- VAT trên (tiền hàng sau CK dòng - CK bill), KHÔNG gồm ship — khớp calculatedTotals local
  IF v_vat_pct > 0 THEN
    v_vat := round(GREATEST(v_line_total - p_discount, 0) * v_vat_pct / 100, 2);
  ELSE
    v_vat := 0;
  END IF;

  SELECT COALESCE((value->>'denominator')::INTEGER, 500)
  INTO v_rounding_denom FROM settings WHERE key = 'cash_rounding';

  -- NEW-CONF-03: chỉ làm tròn khi có method='cash' (giữ nguyên), base cộng thêm VAT
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
    v_debt := round((v_payable + v_vat - p_discount - v_cash_rounding) - v_total_paid, 2);
  END IF;

  UPDATE orders
  SET status = 'completed',
      subtotal = v_payable,
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

-- Xóa overload 4-arg cũ (0003/0007) để PostgREST hết ambiguous
DROP FUNCTION IF EXISTS public.checkout_order(UUID, NUMERIC, JSONB, TEXT);

-- 3) pos_checkout bản VAT (9 args: thêm p_vat_percent cuối + DEFAULT)
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
    'pending', COALESCE(p_shipping_fee, 0), p_note)
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
       COALESCE((it->>'discount_amount')::NUMERIC, 0),
       COALESCE((it->>'processing_fee')::NUMERIC, 0), 0,
       CASE WHEN (it->'dimension_details') IS NOT NULL THEN (it->'dimension_details') ELSE NULL END,
       COALESCE((it->>'waste_factor')::NUMERIC, 0), v_mat);
  END LOOP;

  r := public.checkout_order(v_id, COALESCE(p_discount, 0), COALESCE(p_payments, '[]'::JSONB),
    p_note, COALESCE(p_vat_percent, 0));

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

GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC) TO anon, authenticated;

-- Xóa overload 8-arg cũ (0009) để PostgREST hết ambiguous PGRST203
DROP FUNCTION IF EXISTS public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID);
