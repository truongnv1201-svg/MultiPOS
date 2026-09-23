-- Migration 26 — Chống áp dụng lặp hủy/trả ở tầng DB
-- Lỗ hổng: return_order_items không kiểm tra status -> gọi 2 lần cùng đơn sẽ trừ nợ 2 lần,
-- hoàn tiền 2 lần, cộng kho 2 lần. cancel_order chặn 'cancelled' nhưng không chặn 'returned'
-- -> hủy sau khi trả sẽ hoàn kho + hoàn tiền lặp (càng nặng từ 0025 vì trả đã hoàn kho).
-- App flow chỉ cho completed -> returned/cancelled một lần, nhưng RPC phải tự vệ vì có thể
-- bị gọi trực tiếp hoặc race 2 máy. Sửa: cả 2 RPC RAISE khi status đã ở trạng thái cuối
-- ('cancelled'/'returned'). Không đổi schema — không cần tracking từng phần vì UI hiện tại
-- luôn trả full đơn một lần (OrdersView). Muốn trả 1 phần trong tương lai thì mới cần thêm
-- bảng chi tiết trả.

-- 1) return: chỉ nhận đơn completed/deposit_order (đơn cọc trả -> quyết toán cọc, giữ nguyên
--    logic tiền; kho hoàn như thường)
-- Viết lại toàn hàm (guard mới + giữ nguyên phần còn lại của 0025)
CREATE OR REPLACE FUNCTION public.return_order_items(
    p_order_id UUID,
    p_refund NUMERIC,
    p_restock JSONB DEFAULT '[]'::JSONB
  )
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE
    v_cust UUID;
    v_status TEXT;
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
    SELECT customer_id, status INTO v_cust, v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Đơn không tồn tại'; END IF;
    -- Idempotency guard: đơn đã ở trạng thái cuối thì từ chối (rollback toàn bộ, không tác dụng phụ)
    IF v_status IN ('cancelled', 'returned') THEN
      RAISE EXCEPTION 'Đơn đã % — không xử lý trả lặp', CASE WHEN v_status = 'cancelled' THEN 'hủy' ELSE 'trả' END;
    END IF;
    SELECT order_code INTO v_code FROM public.orders WHERE id = p_order_id;

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

    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_restock, '[]'::JSONB)) LOOP
      SELECT id, product_type INTO v_pid, v_ptype FROM public.products WHERE sku = (r->>'sku');
      IF v_pid IS NULL THEN
        RAISE EXCEPTION 'SKU hoàn kho không tồn tại: %', (r->>'sku');
      END IF;
      IF v_ptype IN ('area', 'service') THEN
        v_skipped := v_skipped || jsonb_build_object('sku', r->>'sku', 'reason', 'area/service không nhập lại');
        CONTINUE;
      END IF;
      v_req := GREATEST(COALESCE((r->>'quantity')::NUMERIC, 0), 0);
      IF v_req <= 0 THEN CONTINUE; END IF;
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
  END; $fn$;

-- 2) cancel: chặn thêm status 'returned' (giữ nguyên logic hoàn kho/đảo nợ/hoàn quỹ của 0024)
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id UUID)
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE
    r RECORD;
    v_code TEXT;
    v_debt NUMERIC;
    v_cust UUID;
  BEGIN
    SELECT * INTO r FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR r.status IN ('cancelled', 'returned') THEN
      RAISE EXCEPTION 'Đơn không hợp lệ (đã hủy/trả)';
    END IF;
    v_code := r.order_code;
    v_debt := COALESCE(r.debt_amount, 0);
    v_cust := r.customer_id;

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

    IF v_debt > 0 AND v_cust IS NOT NULL THEN
      UPDATE public.customers SET current_debt = GREATEST(current_debt - v_debt, 0) WHERE id = v_cust;
    END IF;

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
  END; $fn$;
