# 05 — Khách hàng & công nợ (`components/customers/CustomersView.tsx`)

## 1. Mục đích
Master KH + thu nợ. Một màn: trái là bảng (lọc tên/SĐT/mã, nhóm, trạng thái nợ; sort;
phân trang 25; dải tổng nợ nhóm lọc), phải là thẻ chi tiết (mã, nhóm, nợ hiện tại, hạn mức)
+ nút lập phiếu thu nợ. Modal thu nợ + thêm KH. Nút **Đồng bộ nợ** + Excel (xuất/nhập/mẫu)/In.

## 2. Entity `Customer`
`id · code (KHxxxx) · name* · phone* · address? · group (retail Khách lẻ / contractor
Thợ nhôm kính / wholesale Đại lý-Công trình) · current_debt (≥0) · debt_limit · created_at`.
Template nhập: Tên*, SĐT*, Địa chỉ, Nhóm, Hạn mức.

## 3. Luồng
- Thêm tay: mã `KH+pad4(số lượng+1)`, nợ 0. Nhập Excel: khớp SĐT → cập nhật (giữ nợ cũ),
  mới → tạo; nhóm sai → `retail`; tối đa 10 lỗi/dòng.
- Thu nợ (`collectDebt`, cash/transfer): cần login + ca mở; KH đã lên server mà offline → chặn.
  Online gọi RPC `collect_debt` (server clamp, trả `collected`), local mirror, sinh phiếu thu
  `PT/debt_collection` (tiền mặt cộng vào ca), rồi refresh nợ truth.
- Đồng bộ nợ: server là truth, kéo `current_debt + debt_limit` theo lô 100 uuid, ghi đè local;
  KH lẻ/chưa link bỏ qua (đếm `skipped`).
- Đẩy master lên server qua RPC `sync_customer` (khớp phone→code; KH mới lấy nợ local,
  KH cũ giữ nợ server); map uuid lưu `localStorage`.

## 4. Phân quyền & biên
Thêm/sửa master không guard (làm được cả offline). Thu/đồng bộ cần login (+ ca mở, + online).
Modal thu: `1 ≤ amount ≤ nợ hiện tại`; server báo hết nợ → dừng. Mã tự sinh theo số lượng
dễ trùng sau xóa — nên chuyển sequence server khi có dịp.
