-- Migration 16 — Giai đoạn 2 HRM: đơn từ (nghỉ phép / nghỉ KL / tăng ca / đi muộn / về sớm)
-- Luồng: nhân viên tự gửi đơn của mình -> quản lý duyệt 1 chạm ->
-- app tự ghi vào bảng công (ngày nghỉ / giờ TC / ghi chú muộn) + trừ quỹ phép.
-- Phép năm 12 ngày (HR_POLICY.annualLeaveDays); tồn = 12 - ngày phép đã duyệt trong năm.

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('leave_paid', 'leave_unpaid', 'overtime', 'late', 'early')),
  date_from date not null,
  date_to date not null,
  days numeric(6, 2) not null default 0, -- số ngày công nghỉ (phép/KL), đã trừ Chủ nhật
  overtime_hours numeric(5, 2) not null default 0, -- giờ tăng ca (loại overtime)
  late_minutes int not null default 0 check (late_minutes >= 0), -- phút đi muộn/về sớm
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);
alter table public.leave_requests enable row level security;

-- Đọc: đơn của mình + quản lý đọc hết
drop policy if exists "leave_select" on public.leave_requests;
create policy "leave_select" on public.leave_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_manager());

-- Gửi đơn: chỉ tạo cho chính mình
drop policy if exists "leave_insert_own" on public.leave_requests;
create policy "leave_insert_own" on public.leave_requests
  for insert to authenticated
  with check (user_id = auth.uid());

-- Sửa đơn đang chờ của mình (không được tự duyệt: WITH CHECK giữ pending)
drop policy if exists "leave_update_own_pending" on public.leave_requests;
create policy "leave_update_own_pending" on public.leave_requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'pending');

-- Hủy đơn đang chờ của mình
drop policy if exists "leave_delete_own_pending" on public.leave_requests;
create policy "leave_delete_own_pending" on public.leave_requests
  for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

-- Quản lý: toàn quyền (duyệt/từ chối/sửa/xóa mọi đơn)
drop policy if exists "leave_manager_all" on public.leave_requests;
create policy "leave_manager_all" on public.leave_requests
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create index if not exists idx_leave_user_status on public.leave_requests (user_id, status);
