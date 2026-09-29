-- Migration 61 — Gỡ làm tròn tiền mặt (kế toán yêu cầu 2026-09).
--
-- Vấn đề: khi thu tiền mặt, hệ thống làm tròn xuống bội số mệnh giá (settings.cash_rounding,
-- mặc định 500đ) nên số tiền thực thu khác số tiền khách phải trả. Kế toán yêu cầu bỏ:
-- mọi khoản tiền phải đúng từng đồng, đối soát với chứng từ dễ kiểm tra.
--
-- Cách sửa:
-- 1) checkout_order: v_cash_rounding luôn = 0 (bỏ đọc setting cash_rounding và bỏ
--    khối tính % mệnh giá). Toàn bộ số học phía sau vẫn giữ nguyên nên không lệch.
-- 2) Xoá hàng cấu hình settings.cash_rounding để không còn đường bật lại.
-- 3) KHÔNG xoá cột orders.cash_rounding: các đơn đã làm tròn trước đây vẫn cần giữ số
--    liệu đúng cho báo cáo/đối soát; đơn mới ghi 0. Biểu mẫu in vẫn hiện dòng "làm tròn"
--    khi cash_rounding > 0 nên hoá đơn cũ in ra không bị sai lệch.
-- 4) Client (lib/pricing.ts calcCartTotals) đã bỏ nhánh làm tròn trong cùng đợt.
--
-- Không đổi chữ ký checkout_order -> tương thích mọi call cũ (pos_checkout gọi hàm này).

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
  v_cash_rounding DECIMAL(8,2) := 0; -- luôn 0 (đã gỡ làm tròn tiền)
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
  -- 0061: KHÔNG làm tròn tiền mặt nữa (kế toán yêu cầu giữ đúng từng đồng).
  v_cash_rounding := 0;

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
-- Bỏ cấu hình mệnh giá làm tròn. (Cột orders.cash_rounding giữ lại cho lịch sử.)
delete from public.settings where key = 'cash_rounding';

NOTIFY pgrst, 'reload schema';
