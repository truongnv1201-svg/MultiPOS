# 12 — Đăng nhập & phân quyền

## 1. Đăng nhập (`lib/store/auth.tsx`, `LoginModal.tsx`, `lib/hrm.ts`)
Mã NV (`NV0001` → `nv0001@nv.local`) hoặc email cũ; `signInWithPassword`.
Lỗi Việt hóa: sai mã/MK (phân biệt hoa thường), chưa kích hoạt, rate-limit, thiếu env.
Modal: nhớ mã lần trước, autofocus, Enter/Esc, hiện/ẩn MK, cảnh báo CapsLock;
đã login thành **thẻ phiên** (avatar, tên, badge vai trò, Đổi tài khoản/Đăng xuất/Tiếp tục).

## 2. Cổng & hạ cánh (`app/page.tsx`)
Thiếu env → local-only vào demo thẳng. `needGate = supabaseReady && authReady && !user`
→ màn khóa + form `locked` (mất nút X, Esc/overlay không đóng, tự mở).
Chưa xác thực xong → splash (khỏi nháy POS). Login xong vào **POS** (mọi vai trò).

## 3. Ma trận quyền
| Chức năng | admin | manager | cashier | worker |
|---|---|---|---|---|
| Bán/đơn/KH/NCC/dự án/sổ quỹ | ✓ | ✓ | ✓ | ✓ (xem) |
| Nhập kho, trả NCC, tạm ứng, HRM ghi | ✓ | ✓ | ✗ | ✗ |
| Kho/Chấm công/Lương/Báo cáo (menu+phím tắt) | ✓ | ✓* | ✗ | ✗ |
| Cài đặt + giá mài + làm tròn | ✓ | xem | ✗ | ✗ |
| Tạo/reset tài khoản | mọi role | chỉ cashier/worker | ✗ | ✗ |
| Kết ca/bán hộ ca người khác | override được | override được | ✗ | ✗ |

\* Manager vào Cài đặt chỉ để quản NV; cấu hình hệ thống vẫn khóa trong view.

## 4. Cưỡng chế
RLS: authenticated đọc chung catalog/đơn/KH; cấm thu ngân đổi `current_debt/debt_limit`
qua REST (0031); chấm công/lương/settings/mài chỉ admin/manager; ca insert-own, cấm
sửa/xóa trực tiếp (đi RPC); manager thêm/sửa profile chỉ cashier/worker (chặn leo quyền).
API `app/api/admin/*` (service_role): `create-user` (validate email/MK≥6/role, fail rollback
xóa auth user), `reset-password`; xác thực Bearer + check role caller, manager bị chặn
tạo/reset admin/manager.

## 5. Ghi chú đã biết
`pos_checkout` mở cho `anon` (giữ để tương thích verify cũ) — gọi trực tiếp tự đặt giá được.
Chặn kết ca hộ mới ở client — gọi thẳng RPC vẫn lọt (khóa server khi rảnh).
