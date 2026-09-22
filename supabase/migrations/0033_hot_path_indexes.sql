-- Migration 33 — index đường nóng chống chậm khi bảng phình (go-live).
-- Bối cảnh: checkout/consume/cancel/return đều lọc order_items theo order_id nhưng cột này
-- chưa có index (FK không tự sinh index) -> vài trăm nghìn dòng là seq scan mỗi lần bán.
-- Tương tự: sổ quỹ tra theo mã đơn, thẻ kho theo mã phiếu, đơn/KH lọc theo ngày/trạng thái/SĐT.
-- Toàn IF NOT EXISTS, bảng đang nhỏ nên CREATE INDEX thường (lock nhẹ, xong trong ms).

-- Dòng hàng theo đơn (checkout_order, consume_stock, cancel, return)
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
-- Cap trả hàng theo đơn + sku (0025/0032)
CREATE INDEX IF NOT EXISTS idx_order_items_order_sku ON public.order_items (order_id, sku);

-- Đơn theo KH (nợ), ngày tạo + trạng thái (màn Đơn hàng, báo cáo)
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);

-- Sổ quỹ theo mã đơn (hủy/trả tra cứu phiếu gốc) + ngày (báo cáo, lọc)
CREATE INDEX IF NOT EXISTS idx_cashbook_ref ON public.cashbook_entries (reference_order_code);
CREATE INDEX IF NOT EXISTS idx_cashbook_created ON public.cashbook_entries (created_at DESC);

-- Thẻ kho theo mã phiếu + mặt hàng (lịch sử nhập, truy vết)
CREATE INDEX IF NOT EXISTS idx_stock_ref ON public.stock_movements (reference_code);
CREATE INDEX IF NOT EXISTS idx_stock_product ON public.stock_movements (product_id);

-- KH/NCC theo SĐT (sync_customer upsert theo phone, tìm kiếm POS); code đã unique
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (phone);
CREATE INDEX IF NOT EXISTS idx_suppliers_phone ON public.suppliers (phone);

NOTIFY pgrst, 'reload schema';
