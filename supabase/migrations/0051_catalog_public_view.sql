-- Migration 51 — Khóa catalog public: ẩn giá vốn/tồn khỏi internet (P1 thương mại).
-- Vấn đề: 0007 mở anon SELECT * lên products (để POS chưa login load được catalog),
-- lộ toàn bộ import_price/avg_cost (giá vốn) + trade_price cho internet.
-- Thiết kế:
-- 1) View public.catalog_public chỉ chứa cột bán hàng (không giá vốn):
--    id, sku, barcode, name, category, unit, product_type, retail_price,
--    stock_quantity, min_stock, waste_factor, default_grinding_price, image_url.
-- 2) anon chỉ được SELECT view; products giữ lại cho authenticated (thu ngân đã login).
-- 3) product_variants/grinding_services giữ anon (chỉ chứa giá bán lẻ, cần cho POS chưa login).
-- Client tương ứng: lib/store/catalog.tsx refreshCatalog thử bảng products trước
-- (authenticated), thất bại thì fallback sang catalog_public (anon).

CREATE OR REPLACE VIEW public.catalog_public AS
SELECT
  id, sku, barcode, name, category, unit, product_type, retail_price,
  stock_quantity, min_stock, waste_factor, default_grinding_price, image_url
FROM public.products;

GRANT SELECT ON public.catalog_public TO anon, authenticated;

-- Thu hồi quyền đọc bảng gốc của anon (chỉ còn view an toàn)
DROP POLICY IF EXISTS "catalog_read_anon" ON public.products;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'products_read_authenticated'
      AND tablename = 'products'
  ) THEN
    CREATE POLICY "products_read_authenticated" ON public.products
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
