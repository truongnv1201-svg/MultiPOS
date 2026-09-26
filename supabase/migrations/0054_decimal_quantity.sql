-- 0054: cho phép bán số lượng thập phân theo từng mặt hàng (2,15 kg).
--
-- Bối cảnh: order_items.quantity / products.stock_quantity / stock_movements.quantity
-- đã là numeric(14,3) từ đầu (0002/0003/0005) và pos_checkout đọc ::NUMERIC, nên
-- chỉ thiếu cờ cấu hình để UI biết mặt hàng nào được nhập số lập phân.
-- Mặt hàng đếm theo cái/bao giữ nguyên số nguyên (default false) để tồn kho
-- không bị lệch vô tình.

alter table public.products
  add column if not exists allow_decimal boolean not null default false;

comment on column public.products.allow_decimal is
  'Cho phép nhập số lượng thập phân khi bán/nhập (vd 2,15 kg). Mặc định false = số nguyên.';

-- catalog_public (0051) phải kèm cột mới, nếu không POS chạy anon sẽ đọc undefined
-- và không bật được nhập thập phân. Giữ nguyên 13 cột cũ (không lộ giá vốn).
create or replace view public.catalog_public as
select
  p.id,
  p.sku,
  p.barcode,
  p.name,
  p.category,
  p.unit,
  p.product_type,
  p.retail_price,
  p.stock_quantity,
  p.min_stock,
  p.waste_factor,
  p.default_grinding_price,
  p.image_url,
  p.allow_decimal
from public.products p;

grant select on public.catalog_public to anon, authenticated;
