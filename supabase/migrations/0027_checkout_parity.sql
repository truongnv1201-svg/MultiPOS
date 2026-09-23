-- Migration 27 — Parity tiền local/server từng đồng (phát hiện bởi fuzz verify-pricing-parity)
-- 3 lệch tìm thấy (toàn bộ ở checkout_order, pos_checkout giữ nguyên chữ ký):
-- 1) VAT giữ 2 thập phân (VD base 995925 x 10% = 99592.5đ) trong khi local Math.round về
--    nguyên và VND không có hào. Lệch lan sang total/rounding. Sửa: VAT round 0.
-- 2) Subtotal dòng round 2 thập phân, local Math.round (nguyên). Với đơn giá lẻ (VD 99999)
--    nhân m2 3 số lẻ sẽ lệch xu. Sửa: mọi nấc tiền round 0 (số lượng m2/material giữ nguyên).
-- 3) Cột orders.subtotal đang lưu line_total + ship, trong khi local subtotal là thuần tiền
--    hàng (receipt "Tổng tiền hàng" và báo cáo đọc sai cho đơn online). Sửa: subtotal = line
--    total thuần; total_amount giữ nguyên công thức (line + ship + vat - CK - rounding).
-- Không DROP/đổi chữ ký -> tương thích call cũ.

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

  -- Tính lại dòng area từ JSONB — TIỀN LÀM TRÒN NGUYÊN (khớp Math.round local, VND không hào)
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

  -- Tiền hàng sau CK dòng (thuần, chưa ship, chưa VAT) — cũng là orders.subtotal mới
  SELECT COALESCE(SUM(subtotal - COALESCE(discount_amount, 0)), 0) INTO v_line_total
  FROM order_items WHERE order_id = p_order_id;
  v_payable := v_line_total + COALESCE(v_order.shipping_fee, 0);

  -- VAT trên (tiền hàng sau CK dòng - CK bill), KHÔNG gồm ship — round NGUYÊN (khớp local)
  IF v_vat_pct > 0 THEN
    v_vat := round(GREATEST(v_line_total - p_discount, 0) * v_vat_pct / 100, 0);
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
