# 11 — Cài đặt (`components/settings/SettingsView.tsx`)

## 1. Phạm vi (sau dọn)
7 khối, **không** còn mô phỏng mạng/offline, nút xóa dữ liệu, quản lý nhân viên
(nhân sự làm ở màn HRM). Chưa login → nút Đăng nhập; non-admin → badge chỉ Admin.

## 2. Các khối
1. **Thông tin shop** (in đầu phiếu): tên, hotline, địa chỉ, MST, email, lời cảm ơn,
   chính sách — lưu `localStorage` từng máy, autosave.
2. **Trung tâm in**: mẫu `k80-full` / `a4-invoice` / `a5-invoice` (đồng thời set khổ giấy),
   cỡ chữ S/M/L, số liên 1–3, tự in sau checkout.
3. **Nội dung phiếu**: 6 checkbox (logo, thu ngân, SĐT KH, VietQR, quy cách đo, công nợ).
4. **Mặc định POS** (hóa đơn mới): VAT 0/8/10, hình thức TT, bảng giá lẻ/thợ.
5. **VietQR**: ngân hàng (12 mã) + số TK (6–19 số) + tên; QR động theo số tiền
   (`img.vietqr.io`, `addInfo` không dấu ≤25 ký tự); thiếu → khung chờ, không QR giả.
6. **Giá công mài** (đ/md): đọc server, fallback mock; áp dụng ngay modal F3.
7. **Làm tròn tiền mặt**: 100/500/1000/5000 (mặc định 500); chỉ khi thu cash
   (xem công thức ở `00-tong-quan.md`).

## 3. API & phân quyền
Local: shop/VietQR → `localStorage`. Server: `grinding_services` select/update,
`settings(cash_rounding)` select/update `{value:{denominator}}`, `profiles` cho guard;
tải lại khi online. Mọi ô `disabled` với non-admin; đổi giá mài/làm tròn chỉ Admin
(RLS cưỡng chế, lỗi Việt hóa hiện inline).
