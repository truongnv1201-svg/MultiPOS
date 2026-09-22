-- Migration 32 — P1-2: return_order_items tách nhánh đơn cọc + cap theo nợ của đơn
-- 2 lỗi:
-- 1) Đơn deposit_order trả về bị xử lý y như đơn thường: note hoàn tiền ghi
--    'Hoàn tiền trả hàng' trong khi tiền gốc là cọc (category 'deposit') -> sổ quỹ
--    khó đối chiếu cọc thu/hoàn. Fix: nhánh deposit ghi note 'Hoàn tiền cọc đơn ...'.
-- 2) v_cut = LEAST(p_refund, nợ TỔNG của KH) có thể gạt nợ của đơn khác khi KH nợ
--    nhiều đơn. Fix: cap thêm theo orders.debt_amount của chính đơn này.
-- Giữ chữ ký (UUID, NUMERIC, JSONB) + guard idempotency của 0026.

CREATE OR REPLACE FUNCTION public.return_order_items(
    p_order_id UUID,
    p_refund NUMERIC,
    p_restock JSONB DEFAULT '[]'::JSONB
  )
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE
    v_cust UUID;
    v_status TEXT;
    v_order_debt NUMERIC;
    v_debt NUMERIC;
    v_cut NUMERIC;
    v_cash NUMERIC;
    v_code TEXT;
    v_note TEXT;
    r JSONB;
    v_pid UUID;
    v_ptype TEXT;
    v_req NUMERIC;
    v_sold NUMERIC;
    v_qty NUMERIC;
    v_restocked JSONB := '[]'::JSONB;
    v_skipped JSONB := '[]'::JSONB;
  BEGIN
    SELECT customer_id, status, order_code, COALESCE(debt_amount, 0)
      INTO v_cust, v_status, v_code, v_order_debt
      FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Đơn không tồn tại'; END IF;
    IF v_status IN ('cancelled', 'returned') THEN
      RAISE EXCEPTION 'Đơn đã % — không xử lý trả lặp', CASE WHEN v_status = 'cancelled' THEN 'hủy' ELSE 'trả' END;
    END IF;

    -- Tiền: trừ nợ tối đa theo nợ CỦA ĐƠN này (không gạt nợ đơn khác), dư hoàn tiền mặt.
    -- Đơn cọc: cùng công thức nhưng note hoàn cọc riêng để đối chiếu sổ deposit.
    IF v_cust IS NOT NULL THEN
      SELECT current_debt INTO v_debt FROM public.customers WHERE id = v_cust FOR UPDATE;
      v_cut := LEAST(p_refund, COALESCE(v_debt, 0), COALESCE(v_order_debt, 0));
      v_cut := GREATEST(v_cut, 0);
      v_cash := p_refund - v_cut;
      UPDATE public.customers SET current_debt = current_debt - v_cut WHERE id = v_cust;
    ELSE
      v_cut := 0; v_cash := p_refund;
    END IF;
    IF v_status = 'deposit_order' THEN
      v_note := 'Hoàn tiền cọc đơn ' || v_code;
    ELSE
      v_note := 'Hoàn tiền trả hàng';
    END IF;
    IF v_cash > 0 THEN
      INSERT INTO public.cashbook_entries (code, type, fund_type, category, amount, reference_order_code, note)
      VALUES (public.generate_order_code('PC'), 'expense', 'cash', 'other', v_cash,
        v_code, v_note);
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

GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) TO authenticated;
NOTIFY pgrst, 'reload schema';
