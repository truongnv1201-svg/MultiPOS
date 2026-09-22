-- Migration 07 — P3: POS online qua RPC + catalog đọc ẩn danh + seed hàng hóa
-- 1) checkout_order: cộng shipping_fee vào phải trả (đúng công thức SRS total = subtotal + ship - discount - rounding)
-- 2) pos_checkout RPC nguyên tử: tạo đơn + dòng hàng + gọi checkout (client chỉ gửi ý định — Invariant #5)
-- 3) Anon SELECT catalog (products/variants/grinding) để POS load <3s chưa cần login
-- 4) Seed 11 SKU demo (idempotent, không đụng stock hiện hữu khi chạy lại)

-- 1) Vá checkout_order: tính ship vào payable
CREATE OR REPLACE FUNCTION public.checkout_order(
  p_order_id UUID,
  p_discount DECIMAL,
  p_payments JSONB,
  p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_payable DECIMAL(12,2) := 0;
  v_total_paid DECIMAL(12,2) := 0;
  v_change_amount DECIMAL(12,2) := 0;
  v_debt DECIMAL(12,2) := 0;
  v_paid_allocated DECIMAL(12,2) := 0;
  v_cash_rounding DECIMAL(8,2) := 0;
  v_rounding_denom INTEGER := 500;
  v_code TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Đơn hàng không tồn tại hoặc đã hoàn tất';
  END IF;

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
            FROM jsonb_array_elements(oi.dimension_details) x), 0), 2)
      ELSE
        round(oi.quantity * oi.unit_price + COALESCE(oi.processing_fee, 0), 2)
    END
  WHERE oi.order_id = p_order_id;

  -- POS-ERR-02: trừ discount dòng trước khi cộng ship (SRS: total = subtotal + ship - discount - rounding)
  SELECT COALESCE(SUM(subtotal - COALESCE(discount_amount, 0)), 0) INTO v_payable
  FROM order_items WHERE order_id = p_order_id;
  v_payable := v_payable + COALESCE(v_order.shipping_fee, 0);

  SELECT COALESCE((value->>'denominator')::INTEGER, 500)
  INTO v_rounding_denom FROM settings WHERE key = 'cash_rounding';

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_payments) AS x(method text)
             WHERE x.method = 'cash') THEN
    v_cash_rounding := (v_payable - p_discount) % v_rounding_denom;
  ELSE
    v_cash_rounding := 0;
  END IF;

  SELECT COALESCE(SUM((x->>'amount')::DECIMAL), 0) INTO v_total_paid
  FROM jsonb_array_elements(p_payments) AS x;

  IF v_total_paid > (v_payable - p_discount - v_cash_rounding) THEN
    v_change_amount := v_total_paid - (v_payable - p_discount - v_cash_rounding);
    v_paid_allocated := v_payable - p_discount - v_cash_rounding;
    v_debt := 0;
  ELSE
    v_paid_allocated := v_total_paid;
    v_debt := round((v_payable - p_discount - v_cash_rounding) - v_total_paid, 2);
  END IF;

  UPDATE orders
  SET status = 'completed',
      subtotal = v_payable,
      discount_amount = p_discount,
      cash_rounding = v_cash_rounding,
      total_amount = v_payable - p_discount - v_cash_rounding,
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

  RETURN jsonb_build_object('ok', true, 'order_code', v_code, 'change_amount', v_change_amount);
END;
$$;

-- 2) RPC pos_checkout: 1 call duy nhất từ POS online
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_customer_name TEXT,
  p_items JSONB,
  p_discount NUMERIC DEFAULT 0,
  p_payments JSONB DEFAULT '[]'::JSONB,
  p_note TEXT DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT 0,
  p_is_deposit BOOLEAN DEFAULT FALSE
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
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Giỏ hàng trống';
  END IF;

  v_code := public.generate_order_code('HD');
  INSERT INTO public.orders (order_code, customer_name, status, shipping_fee, note)
  VALUES (v_code, COALESCE(NULLIF(p_customer_name, ''), 'Khách Lẻ'), 'pending', COALESCE(p_shipping_fee, 0), p_note)
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

  -- Đơn cọc: chuyển trạng thái + sổ quỹ sang category deposit (FIN-ERR-01)
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

GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN) TO anon, authenticated;

-- 3) Catalog đọc ẩn danh (POS chưa login vẫn bán được; ghi vẫn cấm — chỉ RPC)
ALTER TABLE public.grinding_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalog_read_anon" ON public.products;
CREATE POLICY "catalog_read_anon" ON public.products FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "variants_read_anon" ON public.product_variants;
CREATE POLICY "variants_read_anon" ON public.product_variants FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "grinding_read_anon" ON public.grinding_services;
CREATE POLICY "grinding_read_anon" ON public.grinding_services FOR SELECT TO anon USING (true);

-- 4) Seed 11 SKU demo (giữ nguyên stock khi chạy lại)
INSERT INTO public.products
  (sku, barcode, name, category, unit, product_type, retail_price, trade_price, import_price, stock_quantity, min_stock, waste_factor, default_grinding_price)
VALUES
  ('SP000001','893000000001','Kính cường lực 10mm Việt Nhật','Nhôm Kính & Tấm','m²','area',380000,340000,280000,450,50,5,20000),
  ('SP000002','893000000002','Kính cường lực 12mm Chuẩn tôi nhiệt','Nhôm Kính & Tấm','m²','area',460000,410000,350000,320,40,6,25000),
  ('SP000003','893000000003','Tấm Alcorest Nhôm Nhựa 3mm','Nhôm Kính & Tấm','m²','area',290000,260000,210000,280,30,4,15000),
  ('SP000004','893000000004','Gỗ MDF Lõi xanh chống ẩm An Cường 18mm','Gỗ & Nội Thất','m²','area',320000,285000,230000,190,25,5,10000),
  ('SP000005','893000000005','Nhôm Xingfa hệ 55 Cửa đi (Cây 5.8m)','Thanh Nhôm & Sắt','cây','goods',490000,450000,390000,120,20,0,0),
  ('SP000006','893000000006','Bản lề sàn VVP Thái Lan FC34-25','Phụ kiện Cửa','bộ','goods',850000,750000,620000,45,10,0,0),
  ('SP000007','893000000007','Keo Silicone Apollo A500 Trắng sữa','Vật tư phụ','chai','goods',62000,55000,45000,340,50,0,0),
  ('SP000008','893000000008','Tay nắm cửa kính Inox 304 D38 dài 600mm','Phụ kiện Cửa','cặp','goods',280000,240000,190000,60,10,0,0),
  ('SP000009','893000000009','Bộ Combo Phụ Kiện Cửa Kính Thủy Lực Đơn','Combo Trọn Bộ','bộ','combo',1350000,1200000,1000000,0,0,0,0),
  ('SP000010','893000000010','Công Lắp đặt & Hoàn thiện Cửa Vách Kính','Dịch vụ Thi công','m²','service',120000,100000,0,9999,0,0,0),
  ('SP000011','893000000011','Vận chuyển xe cẩu chuyên dụng nội thành','Dịch vụ Thi công','chuyến','service',350000,300000,250000,9999,0,0,0)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, unit = EXCLUDED.unit,
  product_type = EXCLUDED.product_type, retail_price = EXCLUDED.retail_price,
  trade_price = EXCLUDED.trade_price, import_price = EXCLUDED.import_price;

INSERT INTO public.combo_items (combo_product_id, child_product_id, child_sku, quantity)
SELECT c.id, p.id, p.sku, v.qty
FROM (VALUES ('SP000009','SP000006',1),('SP000009','SP000008',1),('SP000009','SP000007',2)) AS v(combo, child, qty)
JOIN public.products c ON c.sku = v.combo
JOIN public.products p ON p.sku = v.child
ON CONFLICT (combo_product_id, child_product_id) DO NOTHING;
