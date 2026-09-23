-- Migration 09 — Đồng bộ khách hàng + link công nợ server + server-side debt guard
-- 1) sync_customer: upsert theo phone (rồi code), anon gọi được (SECURITY DEFINER).
--    Row mới lấy current_debt local; row đã có GIỮ nguyên nợ server (server là truth).
-- 2) pos_checkout thêm p_customer_id: ghi orders.customer_id; nợ > 0 mà không có
--    customer -> RAISE (rollback toàn bộ: kho, sổ quỹ, đơn). Chặn nợ vô chủ tầng DB.

CREATE OR REPLACE FUNCTION public.sync_customer(
  p_code TEXT,
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_group TEXT DEFAULT 'retail',
  p_debt_limit NUMERIC DEFAULT 0,
  p_current_debt NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_code TEXT;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Thiếu tên khách hàng';
  END IF;

  IF p_phone IS NOT NULL AND btrim(p_phone) <> '' THEN
    SELECT id INTO v_id FROM public.customers WHERE phone = p_phone LIMIT 1;
  END IF;
  IF v_id IS NULL AND p_code IS NOT NULL AND btrim(p_code) <> '' THEN
    SELECT id INTO v_id FROM public.customers WHERE code = p_code LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    v_code := COALESCE(NULLIF(btrim(p_code), ''), public.generate_master_code('KH', 4));
    INSERT INTO public.customers (code, name, phone, address, customer_group, current_debt, debt_limit)
    VALUES (v_code, p_name, NULLIF(btrim(p_phone), ''), p_address,
      COALESCE(p_group, 'retail'),
      GREATEST(COALESCE(p_current_debt, 0), 0),
      COALESCE(p_debt_limit, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.customers
    SET name = p_name,
        phone = COALESCE(NULLIF(btrim(p_phone), ''), phone),
        address = COALESCE(p_address, address),
        debt_limit = COALESCE(p_debt_limit, debt_limit)
    WHERE id = v_id;
  END IF;

  RETURN (SELECT jsonb_build_object('ok', true, 'id', c.id, 'code', c.code,
    'current_debt', c.current_debt, 'debt_limit', c.debt_limit)
    FROM public.customers c WHERE c.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_customer(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;

-- pos_checkout: thêm p_customer_id (cuối + DEFAULT nên tương thích call cũ)
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_customer_name TEXT,
  p_items JSONB,
  p_discount NUMERIC DEFAULT 0,
  p_payments JSONB DEFAULT '[]'::JSONB,
  p_note TEXT DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT 0,
  p_is_deposit BOOLEAN DEFAULT FALSE,
  p_customer_id UUID DEFAULT NULL
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

  r := public.checkout_order(v_id, COALESCE(p_discount, 0), COALESCE(p_payments, '[]'::JSONB), p_note);

  SELECT debt_amount INTO v_debt FROM public.orders WHERE id = v_id;
  -- Server guard: nợ > 0 bắt buộc có chủ (RAISE -> rollback toàn bộ giao dịch)
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
      'cash_rounding', o.cash_rounding, 'total_amount', o.total_amount,
      'paid_amount', o.paid_amount, 'debt_amount', o.debt_amount, 'status', o.status)
    FROM public.orders o WHERE o.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID) TO anon, authenticated;

-- Xóa overload 7-arg cũ (0007) để PostgREST hết ambiguous PGRST203
DROP FUNCTION IF EXISTS public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN);
