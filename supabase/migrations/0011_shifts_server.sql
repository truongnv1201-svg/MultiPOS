-- Migration 11 — Server hóa ca làm việc (P1)
-- Ca trước đây chỉ lưu IndexedDB -> đa máy trạm lệch nhau, admin không kiểm soát.
-- Chốt: mở/kết ca qua RPC SECURITY DEFINER; client chỉ SELECT ca của mình (+ admin xem hết).

-- Bảng shifts đã tạo ở 0005, RLS đã bật ở 0006 nhưng chưa có policy nào (= deny all).
-- Thêm các cột còn thiếu cho đối soát (giữ tương thích SELECT cũ).
alter table public.shifts
  add column if not exists cash_sales numeric(12,2) not null default 0,
  add column if not exists transfer_sales numeric(12,2) not null default 0,
  add column if not exists deposit_collected numeric(12,2) not null default 0,
  add column if not exists cash_payouts numeric(12,2) not null default 0;

-- RLS policies ---------------------------------------------------------------
drop policy if exists "shifts_select_own_admin" on public.shifts;
create policy "shifts_select_own_admin" on public.shifts
  for select to authenticated
  using (cashier_id = auth.uid() or public.is_admin());

drop policy if exists "shifts_insert_own" on public.shifts;
create policy "shifts_insert_own" on public.shifts
  for insert to authenticated
  with check (cashier_id = auth.uid());

-- Chặn UPDATE/DELETE trực tiếp từ client: mọi kết ca phải qua RPC close_shift
-- (không tạo policy update/delete = deny mặc định khi RLS bật).
drop policy if exists "shifts_no_direct_update" on public.shifts;
drop policy if exists "shifts_no_direct_delete" on public.shifts;

-- RPC mở ca ------------------------------------------------------------------
-- Chặn mở chồng ca: mỗi user chỉ 1 ca open. Tên thu ngân lấy từ profiles.
create or replace function public.open_shift(p_starting_cash numeric default 0)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_open int;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;
  if coalesce(p_starting_cash, 0) < 0 then
    raise exception 'Tiền đầu ca không hợp lệ';
  end if;
  select count(*) into v_open from public.shifts where cashier_id = v_uid and status = 'open';
  if v_open > 0 then
    raise exception 'Bạn vẫn còn ca đang mở — hãy kết ca trước khi mở ca mới';
  end if;
  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.shifts (cashier_id, cashier_name, starting_cash, expected_cash, status)
  values (v_uid, coalesce(v_name, 'Thu ngân'), coalesce(p_starting_cash, 0), coalesce(p_starting_cash, 0), 'open')
  returning id into v_id;
  return (select jsonb_build_object('ok', true, 'id', s.id, 'cashier_name', s.cashier_name,
    'starting_cash', s.starting_cash, 'expected_cash', s.expected_cash, 'opened_at', s.opened_at)
    from public.shifts s where s.id = v_id);
end; $$;

-- RPC kết ca ------------------------------------------------------------------
-- Chốt bất biến: ca closed không được update lần 2. Server tính chênh lệch.
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
  -- Chỉ chủ ca hoặc admin/manager được kết ca
  if v_row.cashier_id <> v_uid and not public.is_admin() then
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

grant execute on function public.open_shift(numeric) to authenticated;
grant execute on function public.close_shift(uuid, numeric) to authenticated;
