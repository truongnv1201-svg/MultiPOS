-- Migration 85 — Nhân viên thường chỉ đọc được dữ liệu nhân sự CỦA CHÍNH MÌNH.
--
-- Bối cảnh (rà 2026-10-15): employees_select / attendance_select / payroll_runs_select /
-- payroll_items_select (0019) và advances_select (0022) đều là `for select ... using (true)`
-- — chỉ policy GHI mới chặn is_manager(). Nghĩa là mọi tài khoản đăng nhập (kể cả worker)
-- đọc được hồ sơ + công + lương của cả cửa hàng qua PostgREST. FlyoutMenu cũng không gate
-- mục 'hr' theo vai trò (Alt+T/Alt+G trong GlobalHeader thì đã chặn bằng blockRestricted),
-- nên thu ngân/worker mở "Quản lý nhân sự" trên desktop là thấy thật ma trận công và bảng
-- lương của mọi người.
--
-- Chốt: siết bằng policy (không thêm RPC my_attendance_month) vì toàn bộ read/write bảng HRM
-- trong client chỉ nằm ở lib/store/hrm-slice.tsx — đổi policy là đổi đúng 1 chỗ, không có
-- đường gọi ẩn ở POS/kho/công trình/sổ quỹ. Nhân viên thường vẫn đọc được công + tạm ứng +
-- dòng lương của chính mình để xem trên điện thoại.
--
-- An toàn: chỉ DROP/CREATE policy + thêm 1 hàm đọc (không sửa dữ liệu, không đổi bảng, không
-- đụng các policy ghi đang chạy). Revert = chạy lại đúng 5 policy `using (true)` cũ.

-- 1) tra hồ sơ của người đang đăng nhập (definer để policy trên bảng khác không bị RLS của
--    employees chặn vòng lặp; owner migration là postgres nên đi qua RLS).
create or replace function public.my_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

revoke all on function public.my_employee_id() from public, anon;
grant execute on function public.my_employee_id() to authenticated;

-- 2) Hồ sơ: quản lý thấy hết, nhân viên thường chỉ thấy dòng của mình (user_id = login).
drop policy if exists "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select to authenticated
  using (public.is_manager() or user_id = auth.uid());

-- 3) Công ngày: attendance_days chỉ có employee_id nên resolve qua my_employee_id().
--    (unique (employee_id, work_date) của 0019 đã có index leading employee_id -> không cần thêm index.)
drop policy if exists "attendance_select" on public.attendance_days;
create policy "attendance_select" on public.attendance_days
  for select to authenticated
  using (public.is_manager() or employee_id = public.my_employee_id());

-- 4) Dòng lương theo nhân viên: chỉ mình nó + quản lý.
drop policy if exists "payroll_items_select" on public.payroll_items;
create policy "payroll_items_select" on public.payroll_items
  for select to authenticated
  using (public.is_manager() or employee_id = public.my_employee_id());

-- 5) Tạm ứng: chỉ mình nó + quản lý.
drop policy if exists "advances_select" on public.salary_advances;
create policy "advances_select" on public.salary_advances
  for select to authenticated
  using (public.is_manager() or employee_id = public.my_employee_id());

-- 6) Bảng lương tháng (run) là tổng hợp của CẢ cửa hàng (headcount, total_net...) nên
--    đóng cho quản lý; nhân viên thường chỉ cần dòng lương của mình ở (4).
drop policy if exists "payroll_runs_select" on public.payroll_runs;
create policy "payroll_runs_select" on public.payroll_runs
  for select to authenticated
  using (public.is_manager());

notify pgrst, 'reload schema';
