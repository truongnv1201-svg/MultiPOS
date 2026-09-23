-- Migration 24 — Hủy đơn hoàn chỉnh + mở quyền gọi RPC tiền/nợ cho client
-- Bối cảnh: cancel_order (0004) chỉ hoàn tiền sổ quỹ, KHÔNG hoàn kho, KHÔNG đảo nợ KH —
-- trong khi client local làm cả 3 -> online là lệch truth (kho thiếu hụt ảo, nợ KH dư).
-- 1) cancel_order viết lại: + hoàn kho (đảo consume_stock_for_order, gồm combo con, có
--    stock_movements kiểm toán) + đảo nợ KH (clamp >= 0 như local FIN-ERR-05).
--    return_order_items / collect_debt giữ nguyên (đã khớp local: clamp + hoàn đúng quỹ).
-- 2) GRANT EXECUTE cho authenticated (0004 quên grant -> PostgREST 401 khi client gọi).
--    Chỉ authenticated (3 RPC này đổi tiền/nợ; client cũng bắt login trước khi gọi).

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_code TEXT;
  v_debt NUMERIC;
  v_cust UUID;
BEGIN
  SELECT * INTO r FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR r.status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn không hợp lệ';
  END IF;
  v_code := r.order_code;
  v_debt := COALESCE(r.debt_amount, 0);
  v_cust := r.customer_id;

  -- 1) Hoàn kho: đảo consume_stock_for_order (GROUP BY, bỏ service/combo cha)
  FOR r IN
    SELECT oi.product_id, oi.product_variant_id,
      SUM(COALESCE(oi.material_consumed, oi.quantity)) AS need
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND oi.item_type NOT IN ('service', 'combo')
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id, oi.product_variant_id
  LOOP
    IF r.product_variant_id IS NOT NULL THEN
      UPDATE public.product_variants SET stock_quantity = stock_quantity + r.need
      WHERE id = r.product_variant_id;
    ELSE
      UPDATE public.products SET stock_quantity = stock_quantity + r.need
      WHERE id = r.product_id;
    END IF;
    INSERT INTO public.stock_movements (reference_code, product_id, quantity, note)
    VALUES (v_code, r.product_id, r.need, 'Hoàn kho hủy đơn ' || v_code);
  END LOOP;

  -- Combo: hoàn linh kiện con theo BOM (khớp chiều trừ ở consume)
  FOR r IN
    SELECT ci.child_product_id AS product_id, SUM(ci.quantity * oi.quantity) AS need
    FROM public.order_items oi
    JOIN public.combo_items ci ON ci.combo_product_id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.item_type = 'combo'
    GROUP BY ci.child_product_id
  LOOP
    UPDATE public.products SET stock_quantity = stock_quantity + r.need WHERE id = r.product_id;
    INSERT INTO public.stock_movements (reference_code, product_id, quantity, note)
    VALUES (v_code, r.product_id, r.need, 'Hoàn kho hủy combo ' || v_code);
  END LOOP;

  -- 2) Đảo nợ KH (clamp >= 0 — khớp local FIN-ERR-05)
  IF v_debt > 0 AND v_cust IS NOT NULL THEN
    UPDATE public.customers SET current_debt = GREATEST(current_debt - v_debt, 0) WHERE id = v_cust;
  END IF;

  -- 3) Hoàn đúng từng quỹ gốc (giữ nguyên 0004 FIN-ERR-05)
  FOR r IN
    SELECT * FROM public.cashbook_entries
    WHERE reference_order_code = v_code AND type = 'receipt'
  LOOP
    INSERT INTO public.cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
    VALUES (public.generate_order_code('PC'), 'expense', r.fund_type, 'other',
      r.amount, r.reference_order_code, 'Hủy đơn hoàn ' || r.fund_type);
  END LOOP;

  UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_debt(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
