-- Migration 56 — index cho pull biến động kho.
-- refreshServerStockMovements() kéo bảng này bằng
--   ORDER BY created_at DESC LIMIT 2000
-- nhưng trước đó chỉ có idx_stock_ref (reference_code) và idx_stock_product
-- (product_id) — Postgres phải sort toàn bảng ở mỗi lần đồng bộ. Đây cũng là bảng
-- nặng nhất: đo thực tế ~240 KB / 2.000 dòng, chiếm 48% lưu lượng của một lần bán.
-- Cửa sổ đọc cũng là `created_at` nên index DESC phục vụ đúng cả hai.
-- Idempotent, chạy lại không lỗi. CREATE INDEX thường (không CONCURRENTLY) vì
-- bảng nhỏ và runner hiện tại không mở transaction song song.
CREATE INDEX IF NOT EXISTS idx_stock_created ON public.stock_movements (created_at DESC);
