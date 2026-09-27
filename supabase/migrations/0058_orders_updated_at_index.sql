-- Migration 58 — index cho truy vấn delta của đơn hàng.
-- lib/store/tx/orders-sync.ts kéo phần thay đổi bằng
--   WHERE updated_at >= <watermark> ORDER BY updated_at DESC LIMIT 500
-- Nếu không có index, mỗi lần đồng bộ lại quét toàn bảng orders (đang có idx_orders_created
-- nhưng created_at không dùng cho truy vấn này). Cùng index này phục vụ luôn cho các
-- nơi cần đơn vừa thay đổi.
-- Idempotent, chạy lại không lỗi.
CREATE INDEX IF NOT EXISTS idx_orders_updated ON public.orders (updated_at DESC);
