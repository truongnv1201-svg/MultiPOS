-- Migration 0082 — Chế độ chấm công nhân sự (miễn chấm công cho admin/quản lý).
-- Bệnh: mọi NV active đều chiếm 1 dòng lưới chấm công; admin/quản lý không chấm thì
-- báo thiếu công, KPI sĩ số sai, bảng lương suy từ attendance_days nên thiếu.
-- Fix: thêm cột employees.attendance_mode ('normal' | 'fixed' | 'none', mặc định
-- 'normal' — tương thích ngược, dữ liệu cũ giữ nguyên flow):
--   normal: chấm công bình thường (thợ/thu ngân).
--   fixed:  miễn chấm công, ăn lương tháng cố định đủ 26 công chuẩn (không cần
--           bản ghi attendance_days; vẫn tạm ứng/lên bảng lương, note "cố định").
--   none:   miễn chấm công + KHÔNG lên bảng lương (chủ/cộng tác viên không lương;
--           vẫn giữ hồ sơ + tài khoản đăng nhập, chặn tạm ứng).
-- Ai được đổi: chỉ Admin (guard ở app: saveEmployee/createEmployee chặn manager).
-- Không đụng RLS/auth (giữ status='active' nên dropdown công trình/sổ quỹ giữ nguyên).

alter table public.employees
  add column if not exists attendance_mode text not null default 'normal'
  check (attendance_mode in ('normal', 'fixed', 'none'));

create index if not exists idx_employees_attendance_mode on public.employees (attendance_mode);
