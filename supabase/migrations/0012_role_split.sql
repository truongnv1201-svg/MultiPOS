-- Migration 12 — Tách admin != manager (P2)
-- Trước đây is_admin() = admin/manager gộp chung -> manager sửa được settings hệ thống.
-- Chốt mới: admin = toàn quyền hệ thống; manager = vận hành (kho, chấm công, xem hết ca).

-- 1) Thu hẹp is_admin() chỉ còn 'admin'
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 2) Thêm is_manager() = admin + manager (dùng cho nghiệp vụ vận hành)
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','manager'));
$$;

-- 3) Settings + grinding: chỉ admin (hệ thống)
drop policy if exists "settings_admin_write" on public.settings;
create policy "settings_admin_write" on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "grinding_admin_write" on public.grinding_services;
create policy "grinding_admin_write" on public.grinding_services
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 4) Chấm công: manager được ghi (vận hành)
drop policy if exists "attendance_admin_write" on public.attendance_records;
create policy "attendance_admin_write" on public.attendance_records
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- 5) Profiles: chỉ admin quản trị role
drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 6) Ca: manager được xem hết để giám sát (thu ngân chỉ thấy ca mình)
drop policy if exists "shifts_select_own_admin" on public.shifts;
create policy "shifts_select_own_admin" on public.shifts
  for select to authenticated
  using (cashier_id = auth.uid() or public.is_manager());

grant execute on function public.is_manager() to authenticated, anon;

-- 7) close_shift: chủ ca hoặc manager (admin/manager) được kết ca hộ
create or replace function public.close_shift(p_shift_id uuid, p_counted_cash numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_diff numeric;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;
  if p_shift_id is null or p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Số tiền kiểm đếm không hợp lệ';
  end if;
  select * into v_row from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Ca không tồn tại';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Ca này đã được kết trước đó';
  end if;
  if v_row.cashier_id <> v_uid and not public.is_manager() then
    raise exception 'Bạn không có quyền kết ca của người khác';
  end if;
  v_diff := p_counted_cash - coalesce(v_row.expected_cash, 0);
  update public.shifts
  set status = 'closed', closed_at = now(),
      counted_cash = p_counted_cash, cash_difference = v_diff
  where id = p_shift_id;
  return jsonb_build_object('ok', true, 'id', p_shift_id,
    'expected_cash', v_row.expected_cash, 'counted_cash', p_counted_cash, 'cash_difference', v_diff);
end; $$;
