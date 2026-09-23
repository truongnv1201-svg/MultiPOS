-- Migration 43 — Idempotency cho pos_checkout (P0).
-- Vấn đề: replay đơn offline (và cả checkout online gặp timeout mập mờ) gọi lại
-- RPC mà không có khóa màn nhiệm -> mỗi lần retry sinh 1 đơn mới + trừ kho/nợ
-- thêm lần nữa. Local chỉ lật is_offline, không remap id server.
-- Thiết kế:
-- 1) orders.client_ref (unique, nullable): khóa do client sinh (`ord-<ms>-<rand>`),
--    ổn định qua mọi lần retry của cùng 1 đơn.
-- 2) pos_checkout thêm p_client_ref (DEFAULT NULL để call 9-arg cũ vẫn chạy):
--    gặp đơn cùng client_ref -> trả lại summary đơn đó, KHÔNG side-effect thêm.
-- 3) Dọn overload 9-arg cũ (0028) để PostgREST không nhập nhằng; call thiếu
--    p_client_ref vẫn được nhờ DEFAULT NULL.

alter table public.orders
  add column if not exists client_ref text;
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_orders_client_ref') then
    create unique index uq_orders_client_ref on public.orders(client_ref);
  end if;
end $$;

-- Dọn overload cũ để chỉ còn bản 10-arg duy nhất
drop function if exists public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC);

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
  v_pid UUID;
  v_waste NUMERIC;
  v_mat NUMERIC;
  v_m2 NUMERIC;
  v_debt NUMERIC;
  v_ptype TEXT;
  v_child_type TEXT;
  v_dup RECORD;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Giỏ hàng trống';
  END IF;

  -- Idempotency: đơn này đã commit ở lần gọi trước -> trả lại, không làm gì thêm.
  -- (change_amount không lưu server nên trả 0 + cờ duplicate để client biết.)
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
  INSERT INTO public.orders (order_code, customer_id, customer_name, status, shipping_fee, note, client_ref)
  VALUES (v_code, p_customer_id, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'),
    'pending', COALESCE(p_shipping_fee, 0), p_note,
    NULLIF(p_client_ref, ''))
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

-- Giữ nguyên phân quyền 0028 (CREATE OR REPLACE giữ grant cũ, nhưng bản DROP +
-- CREATE trên vẫn cần khóa lại cho chắc vì signature đã đổi)
REVOKE EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
