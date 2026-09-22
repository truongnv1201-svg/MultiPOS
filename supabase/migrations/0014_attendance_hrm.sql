-- Migration 14 — Chấm công kiểu HRM: gắn nhân viên (profiles), trạng thái ngày công, tăng ca
-- Bối cảnh: attendance_records trước đây chỉ lưu tên thợ tự do (worker_name), không link được
-- với danh sách nhân viên mà quản lý đã tạo (admin/manager/cashier/worker trong profiles).
-- Chốt mới: mỗi dòng công gắn user_id (nhân viên), trạng thái chuẩn HRM, giờ tăng ca, ghi chú;
-- mỗi nhân viên có lương ngày (profiles.daily_wage) để tính tổng lương tháng.

-- 1) Cột mới cho attendance_records
alter table public.attendance_records
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists status text not null default 'present'
    check (status in ('present', 'half', 'leave_paid', 'leave_unpaid', 'holiday')),
  add column if not exists overtime_hours numeric(5, 2) not null default 0 check (overtime_hours >= 0),
  add column if not exists note text;

-- Index tra bảng công tháng (user + tháng)
create index if not exists idx_attendance_user_month
  on public.attendance_records (user_id, work_date);

-- 2) Lương ngày của nhân viên (quản lý sửa cho cashier/worker, admin sửa tất cả — theo RLS profiles sẵn có)
alter table public.profiles
  add column if not exists daily_wage numeric(12, 2) not null default 0 check (daily_wage >= 0);

-- 3) RLS attendance_records giữ nguyên (0012): authenticated đọc hết, admin/manager ghi hết.
-- Không cần policy mới vì FOR ALL trên bảng đã bao phủ cột mới.
