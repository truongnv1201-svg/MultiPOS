# 03 — Hàng hóa (`components/products/ProductsView.tsx`, `lib/store/catalog.tsx`)

## 1. Mục đích
Quản lý danh mục + bảng giá. Không chia tab; lọc đồng thời: tìm (tên/SKU/danh mục),
nút loại (`all/area/goods/combo/service`), select danh mục, select tồn
(`low ≤15 / out =0 / in_stock >15`). Dải đếm theo 4 loại; sort header; phân trang;
Excel xuất/nhập/tải mẫu, In.

## 2. Entity `Product` (`lib/types.ts`)
`id · sku (SP0000xx tự sinh) · barcode? · name* · category · unit (m²/cây/cái/bộ/md) ·
product_type (goods|area|combo|service) · retail_price · trade_price? · import_price ·
avg_cost (vốn BQ) · stock_quantity · min_stock? · waste_factor? (% hao hụt, chỉ area) ·
default_grinding_price? (đ/md) · combo_items[] {product_id, sku, name, quantity} · image?`
Template Excel: Mã SKU, Tên*, Danh mục, ĐVT, Loại, Giá lẻ, Giá thợ, Giá vốn nhập,
Tồn kho, Tồn tối thiểu, Hao hụt(%).

## 3. Luồng
- Thêm tay: `avg_cost = import_price` (DB trigger `trg_init_variant_avg_cost` bảo vệ);
  chỉ `area` lưu hao hụt + giá mài; `service/combo` ẩn tồn đầu kỳ.
- Nhập Excel: validate từng dòng (thiếu tên → lỗi `Dòng i`, tối đa 10 lỗi),
  `product_type` lạ → `goods`, số âm kẹp 0; upsert theo SKU, else theo tên+ĐVT.
- Đọc catalog server (`products order sku`) + cache Dexie; lỗi giữ dữ liệu local
  (`catalogSource`).

## 4. Phân quyền & biên
Chỉ Admin/Quản lý thêm/sửa (khi có Supabase); thu ngân/thợ xem/lọc/xuất/in.
`area` hiện hao hụt; `combo` hiện linh kiện con, tồn cha không có ý nghĩa (bán trừ kho con);
`service` không tính tồn, loại khỏi lọc tồn.

## 5. Ghi chú đã biết
Ghi master hiện local-first (chưa insert server trực tiếp); tồn cha của combo nên chốt luôn = 0.
