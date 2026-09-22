# 06 — Nhà cung cấp (`components/suppliers/SuppliersView.tsx`)

## 1. Mục đích
NCC + công nợ phải trả. Header: badge tổng nợ, chuyển tab Danh sách/Lịch sử nhập,
Thêm NCC, TableTools theo tab. 2 tab trong `DataTableShell` riêng
(filter + dải đếm + bảng sticky + phân trang).

## 2. Entity `Supplier`
`id · code (NCC… tự sinh) · name* · phone · address? · tax_code? · credit_limit? ·
current_debt`. Modal tay: tên*, SĐT, mã số thuế, địa chỉ, dư nợ ban đầu.
Lịch sử nhập là view phái sinh từ thẻ kho (`movement_type=import`), lọc mã phiếu/tên/ghi chú + ngày.

## 3. Luồng
- Nhập Excel: upsert theo SĐT (ưu tiên) else tên (không phân biệt hoa thường);
  mới → nợ 0; tối đa 10 lỗi.
- Chi trả nợ (`paySupplierDebt`, cash/transfer, mặc định = toàn bộ nợ, min 1000đ):
  `newDebt = max(0, nợ − chi)`; sinh phiếu chi `PC/material` + cập nhật Dexie.
- Lịch sử nhập không có đơn giá/NCC id — đối soát công nợ phải đọc `note` tự do.

## 4. Phân quyền & biên
Chi trả: Admin/Quản lý. SĐT rỗng vẫn lưu; trùng tên khác SĐT dễ ghi đè khi nhập.
`credit_limit` chỉ xuất Excel, chưa kiểm tra khi nhập/trả.

## 5. Ghi chú đã biết (cần siết khi rảnh)
NCC hiện **local-only** (chưa sync server như KH/hàng; REST bị RLS chặn, muốn server hóa phải đi RPC).
`addSupplier/updateSupplier` chưa check role (thu ngân vẫn thêm/sửa được) — không đồng nhất
với hàng hóa. `PurchaseOrder` (type đã có) chưa có màn hình.
