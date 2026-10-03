-- Migration 69 — Trả từng phần đúng trạng thái + chống hoàn kho lặp.
--
-- 1) Sổ order_return_lines (order_id, sku, quantity): mỗi lần trả ghi dòng đã
--    nhập lại kho. Lần trả sau cap theo (đã bán - đã trả) nên trả lặp không cộng
--    kho lặp (trước đây cap theo đã bán nên lần 2 cộng thêm lần nữa).
-- 2) Trạng thái: trả hết số trả được -> 'returned', còn lại -> 'partial_returned'
--    (trả tiếp được; hủy nguyên đơn bị chặn cả client lẫn server để khỏi hoàn
--    tiền 2 lần). Hàng area/service không nhập lại nên không tính vào số phải trả.
-- 3) cancel_order: từ chối đơn partial_returned.
-- Body 2 hàm copy y hệt 0032/0026, chỉ thêm phần sổ + trạng thái + chặn hủy.

CREATE TABLE IF NOT EXISTS public.order_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_return_lines_order ON public.order_return_lines(order_id);

-- Nới CHECK trạng thái đơn (0003) cho giá trị mới 'partial_returned'.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'deposit_order', 'completed', 'cancelled', 'returned', 'partial_returned'));

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
    v_returned NUMERIC;
    v_total_sold NUMERIC;
    v_total_returned NUMERIC;
    v_new_status TEXT;
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
      -- Trừ phần đã trả các lần trước (sổ order_return_lines) để trả lặp không cộng kho lặp.
      SELECT COALESCE(SUM(quantity), 0) INTO v_returned FROM public.order_return_lines
      WHERE order_id = p_order_id AND sku = (r->>'sku');
      v_qty := LEAST(v_req, GREATEST(v_sold - v_returned, 0));
      IF v_qty <= 0 THEN
        v_skipped := v_skipped || jsonb_build_object('sku', r->>'sku', 'reason', 'vượt SL đã bán');
        CONTINUE;
      END IF;
      UPDATE public.products SET stock_quantity = stock_quantity + v_qty WHERE id = v_pid;
      INSERT INTO public.stock_movements (reference_code, product_id, quantity, note)
      VALUES (v_code, v_pid, v_qty, 'Nhập lại trả hàng ' || v_code);
      v_restocked := v_restocked || jsonb_build_object('sku', r->>'sku', 'quantity', v_qty);
      INSERT INTO public.order_return_lines (order_id, sku, quantity)
      VALUES (p_order_id, (r->>'sku'), v_qty);
    END LOOP;

    -- Trả hết số trả được mới là 'returned', còn lại là 'partial_returned'
      -- (trả tiếp được — client cho trả đơn ở cả 2 trạng thái này).
      -- Hàng area/service không nhập lại nên không tính vào số phải trả.
      SELECT COALESCE(SUM(q), 0) INTO v_total_sold FROM (
        SELECT SUM(oi.quantity) AS q FROM public.order_items oi
        WHERE oi.order_id = p_order_id AND oi.item_type = 'goods'
        UNION ALL
        SELECT SUM(ci.quantity * oi.quantity) FROM public.order_items oi
        JOIN public.combo_items ci ON ci.combo_product_id = oi.product_id
        WHERE oi.order_id = p_order_id AND oi.item_type = 'combo'
      ) s;
      SELECT COALESCE(SUM(quantity), 0) INTO v_total_returned FROM public.order_return_lines
      WHERE order_id = p_order_id;
      v_new_status := CASE WHEN v_total_returned >= v_total_sold THEN 'returned' ELSE 'partial_returned' END;
      UPDATE public.orders SET status = v_new_status, updated_at = NOW() WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'debt_cut', v_cut, 'cash_refund', v_cash,
      'restocked', v_restocked, 'skipped', v_skipped, 'status', v_new_status);
  END; $fn$;

GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) TO authenticated;
NOTIFY pgrst, 'reload schema';

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
    IF r.status = 'partial_returned' THEN
      RAISE EXCEPTION 'Đơn đã trả một phần — hoàn nốt phần còn lại, không hủy nguyên đơn (kẻo hoàn tiền 2 lần)';
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
