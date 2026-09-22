# 04 — Kho & nhập hàng (`components/inventory/InventoryView.tsx`)

## 1. Mục đích
Kho theo **giá vốn bình quân MAC**. 2 tab: `Tồn kho thực tế` và `Nhật ký thẻ kho`
(`StockMovement`: `import | export_sales | export_project | return`, SL +/−, tồn trước/sau,
mã phiếu, ghi chú). Mỗi tab có TableTools + phân trang + sort riêng; lọc tồn
(tên/SKU, danh mục, ngưỡng 15/0), lọc thẻ kho (mã/tên/note, ngày, loại). Nút
"Tạo phiếu nhập" nhảy sang POS chế độ nhập (không modal tại chỗ).

## 2. Công thức MAC (`lib/store/transactions.tsx`)
Nhập đơn dòng hoặc nhập batch nhiều dòng chung 1 mã `NH-YYMMDD-XXXX` + 1 phiếu chi `PC`
tổng tiền (`bank`, `material`):
`newStock = oldStock + qty`
`newAvg = round((oldStock×oldAvg + qty×importPrice) / newStock)` (tồn 0 → = importPrice),
tính nối tiếp theo thứ tự dòng để đúng khi trùng hàng. Cập nhật tồn + vốn + giá nhập cuối;
ghi thẻ kho `MAC: cũđ → mớiđ`. POS hiện preview vốn trước khi chốt.
Điều kiện: dòng `qty>0 && price>0`, ca mở, Admin/Quản lý (khi có Supabase).

## 3. Xuất/hoàn (không trừ tay ở màn này)
- Bán (`export_sales`): checkout trừ (goods đủ SL, area theo m²×waste, combo trừ con, bỏ service);
  chặn bán lố (báo `SKU (tồn x, cần y)`), không kẹp tồn về 0.
- Công trình (`export_project`): trigger `trg_project_material_stock` trừ + ghi thẻ âm, hết kho báo lỗi.
- Trả hàng (`return`): RPC hoàn theo chính sách 0025/0032.
- Tổng giá trị kho = Σ(tồn>0 × vốn); tồn ≤0 không cộng.

## 4. Phân quyền & biên
Nhập kho: Admin/Quản lý. Xem tồn/thẻ: mọi role đã login (catalog đọc được cả ẩn danh để POS mở <3s).
Ngưỡng cảnh báo cứng 15 khác `min_stock` từng SKU (min_stock mới chỉ dùng khi xuất Excel).
