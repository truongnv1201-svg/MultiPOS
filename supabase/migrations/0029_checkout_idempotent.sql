-- Migration 29 — Idempotency checkout theo client_uuid (P0)
-- Lỗ hổng: RPC thành công nhưng rớt response (timeout/retry, replay offline) -> client gửi
-- lại -> server tạo ĐƠN TRÙNG (order_code do server tự sinh, không có khóa dedupe).
-- Sửa:
-- 1) orders.client_uuid UUID UNIQUE (nullable — đơn cũ không có vẫn hợp lệ).
-- 2) pos_checkout thêm p_client_uuid (cuối + DEFAULT -> call 9-arg cũ vẫn chạy):
--    - trùng uuid -> trả về đơn đã tạo (duplicate:true), KHÔNG tạo mới, không trừ kho lần 2.
--    - race 2 request cùng uuid -> INSERT ... ON CONFLICT DO NOTHING + lấy lại đơn thắng.
--    - change_amount của đơn cũ không lưu ở DB -> hit dedupe trả change 0 + cờ duplicate
--      để client hiển thị đúng (tiền hàng/nợ đã trả vẫn chính xác).
-- 3) Drop overload 9-arg cũ (mẫu 0009/0023) + GRANT lại signature 10-arg (vá lớp
--    DROP-mất-quyền). File idempotent — chạy lại an toàn.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_uuid UUID;
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_uuid_uidx ON public.orders (client_uuid);

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
  p_client_uuid UUID DEFAULT NULL
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

  -- Idempotency hit: retry/replay cùng uuid -> trả đơn đã tạo, không tác dụng phụ
  IF p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_id FROM public.orders WHERE client_uuid = p_client_uuid;
    IF v_id IS NOT NULL THEN
      RETURN (SELECT jsonb_build_object(
          'ok', true, 'duplicate', true, 'order_id', v_id, 'order_code', o.order_code,
          'change_amount', 0,
          'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
          'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
          'cash_rounding', o.cash_rounding, 'total_amount', o.total_amount,
          'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
        FROM public.orders o WHERE o.id = v_id);
    END IF;
  END IF;

  v_code := public.generate_order_code('HD');
  INSERT INTO public.orders (order_code, customer_id, customer_name, status, shipping_fee, note, client_uuid)
  VALUES (v_code, p_customer_id, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'),
    'pending', GREATEST(COALESCE(p_shipping_fee, 0), 0), p_note, p_client_uuid)
  ON CONFLICT (client_uuid) DO NOTHING
  RETURNING id INTO v_id;

  -- Race cùng uuid: request thua lấy lại đơn của request thắng
  IF v_id IS NULL AND p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_id FROM public.orders WHERE client_uuid = p_client_uuid;
    IF v_id IS NOT NULL THEN
      RETURN (SELECT jsonb_build_object(
          'ok', true, 'duplicate', true, 'order_id', v_id, 'order_code', o.order_code,
          'change_amount', 0,
          'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
          'vat_amount', o.vat_amount, 'vat_percent', o.vat_percent,
          'cash_rounding', o.cash_rounding, 'total_amount', o.total_amount,
          'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
        FROM public.orders o WHERE o.id = v_id);
    END IF;
    RAISE EXCEPTION 'Không tạo được đơn (xung đột idempotency)';
  END IF;

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

-- Xóa overload 9-arg cũ (0023/0028) để PostgREST hết ambiguous PGRST203
DROP FUNCTION IF EXISTS public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC);

GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, UUID) TO anon, authenticated;
-- Chốt lại quyền chuỗi tiền/nợ (idempotent)
GRANT EXECUTE ON FUNCTION public.sync_customer(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_debt(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
