-- Migration 13 — Manager được tự thêm/quản lý nhân viên (cashier/worker)
-- Vấn đề: profiles_admin_all chỉ is_admin() (= admin) nên quản lý cửa hàng không thêm được NV mới,
-- phải nhờ Admin vào Supabase Dashboard.
-- Chốt mới:
--   admin   = toàn quyền (mọi role, kể cả tạo admin/manager khác, xóa user)
--   manager = quản lý nhân sự vận hành: đọc hết profiles, thêm mới + sửa (full_name/role)
--             CHỈ trong phạm vi cashier/worker; không được chạm admin/manager, không leo quyền.

-- 1) Manager được đọc toàn bộ profiles (để thấy danh sách NV cửa hàng)
drop policy if exists "profiles_manager_read" on public.profiles;
create policy "profiles_manager_read" on public.profiles
  for select to authenticated
  using (public.is_manager());

-- 2) Manager được INSERT profiles chỉ với role cashier/worker
-- (Luồng tạo NV mới đi qua API /api/admin/create-user với service_role;
--  policy này là lớp chặn bổ sung nếu client insert trực tiếp.)
drop policy if exists "profiles_manager_insert" on public.profiles;
create policy "profiles_manager_insert" on public.profiles
  for insert to authenticated
  with check (public.is_manager() and role in ('cashier', 'worker'));

-- 3) Manager được UPDATE nhân viên cấp dưới (cashier/worker -> cashier/worker)
-- USING kiểm tra dòng CŨ, WITH CHECK kiểm tra dòng MỚI -> chặn:
--   - sửa profile admin/manager (USING fail)
--   - tự nâng NV lên admin/manager (WITH CHECK fail)
drop policy if exists "profiles_manager_update" on public.profiles;
create policy "profiles_manager_update" on public.profiles
  for update to authenticated
  using (public.is_manager() and role in ('cashier', 'worker'))
  with check (role in ('cashier', 'worker'));

-- 4) Không mở DELETE cho manager: chỉ admin được xóa (profiles_admin_all giữ nguyên).
-- 5) Giữ nguyên: profiles_self_read (tự đọc) + profiles_admin_all (admin toàn quyền).
