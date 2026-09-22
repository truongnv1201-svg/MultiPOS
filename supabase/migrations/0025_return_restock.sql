-- Migration 25 — Trả hàng hoàn kho có chính sách
-- Chính sách (chốt với user):
--   goods   -> hoàn đủ SL trả lại
--   combo   -> hoàn linh kiện con theo BOM (client rã sẵn thành sku con, server cap theo BOMxSL cha)
--   area (kính/tấm đã cắt theo kích thước) + service -> KHÔNG hoàn (coi như tiêu hao),
--     server từ chối thẳng entry area/service kể cả client có gửi (defense in depth)
--   cap mỗi sku = SL đã bán (dòng trực tiếp + BOM combo), chống khai khống
-- Lưu ý: chống trả 2 lần dựa vào app flow (chỉ đơn completed mới trả được); RPC không giữ
-- lịch sử trả từng phần — trả lặp cùng đơn sẽ cộng kho lặp. Đừng gọi 2 lần cho 1 đơn.
-- 1) return_order_items thêm p_restock JSONB [{sku, quantity}] (DEFAULT -> call 2-arg cũ vẫn chạy,
--    mặc định không hoàn kho = hành vi cũ)
-- 2) Drop overload 2-arg cũ để PostgREST hết ambiguous + GRANT lại cho signature mới
--    (GRANT gắn theo signature; 0024 grant bản cũ không còn tác dụng sau DROP).

CREATE OR REPLACE FUNCTION public.return_order_items(
  p_order_id UUID,
  p_refund NUMERIC,
  p_restock JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cust UUID;
  v_debt NUMERIC;
  v_cut NUMERIC;
  v_cash NUMERIC;
  v_code TEXT;
  r JSONB;
  v_pid UUID;
  v_ptype TEXT;
  v_req NUMERIC;
  v_sold NUMERIC;
  v_qty NUMERIC;
  v_restocked JSONB := '[]'::JSONB;
  v_skipped JSONB := '[]'::JSONB;
BEGIN
  SELECT customer_id INTO v_cust FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Đơn không tồn tại'; END IF;
  SELECT order_code INTO v_code FROM public.orders WHERE id = p_order_id;

  -- Tiền: giữ nguyên 0004 (trừ nợ tối đa, dư hoàn tiền mặt)
  IF v_cust IS NOT NULL THEN
    SELECT current_debt INTO v_debt FROM public.customers WHERE id = v_cust FOR UPDATE;
    v_cut := LEAST(p_refund, v_debt);
    v_cash := p_refund - v_cut;
    UPDATE public.customers SET current_debt = current_debt - v_cut WHERE id = v_cust;
  ELSE
    v_cut := 0; v_cash := p_refund;
  END IF;
  IF v_cash > 0 THEN
    INSERT INTO public.cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
    VALUES (public.generate_order_code('PC'), 'expense', 'cash', 'other', v_cash,
      v_code, 'Hoàn tiền trả hàng');
  END IF;

  -- Kho: từng entry {sku, quantity}
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_restock, '[]'::JSONB)) LOOP
    SELECT id, product_type INTO v_pid, v_ptype FROM public.products WHERE sku = (r->>'sku');
    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'SKU hoàn kho không tồn tại: %', (r->>'sku');
    END IF;
    -- area/service không hoàn (hàng đã cắt/tiêu hao) — báo skipped thay vì lỗi để lô không gãy
    IF v_ptype IN ('area', 'service') THEN
      v_skipped := v_skipped || jsonb_build_object('sku', r->>'sku', 'reason', 'area/service không nhập lại');
      CONTINUE;
    END IF;
    v_req := GREATEST(COALESCE((r->>'quantity')::NUMERIC, 0), 0);
    IF v_req <= 0 THEN CONTINUE; END IF;
    -- Cap = SL đã bán: dòng trực tiếp cùng sku + BOM combo (con = ci.quantity x SL cha)
    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_sold FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.sku = (r->>'sku') AND oi.item_type NOT IN ('combo');
    SELECT v_sold + COALESCE(SUM(ci.quantity * oi.quantity), 0) INTO v_sold
    FROM public.order_items oi
    JOIN public.combo_items ci ON ci.combo_product_id = oi.product_id
    JOIN public.products cp ON cp.id = ci.child_product_id AND cp.sku = (r->>'sku')
    WHERE oi.order_id = p_order_id AND oi.item_type = 'combo';
    v_qty := LEAST(v_req, v_sold);
    IF v_qty <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('sku', r->>'sku', 'reason', 'vượt SL đã bán');
      CONTINUE;
    END IF;
    UPDATE public.products SET stock_quantity = stock_quantity + v_qty WHERE id = v_pid;
    INSERT INTO public.stock_movements (reference_code, product_id, quantity, note)
    VALUES (v_code, v_pid, v_qty, 'Nhập lại trả hàng ' || v_code);
    v_restocked := v_restocked || jsonb_build_object('sku', r->>'sku', 'quantity', v_qty);
  END LOOP;

  UPDATE public.orders SET status = 'returned', updated_at = NOW() WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'debt_cut', v_cut, 'cash_refund', v_cash,
    'restocked', v_restocked, 'skipped', v_skipped);
END; $$;

DROP FUNCTION IF EXISTS public.return_order_items(UUID, NUMERIC);
GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) TO authenticated;
