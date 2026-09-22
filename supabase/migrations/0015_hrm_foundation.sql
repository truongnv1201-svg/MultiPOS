-- Migration 15 — Giai đoạn 1 HRM: hồ sơ nhân sự đầy đủ + chốt bảng công tháng
-- Quy định mặc định (user chốt): giờ chuẩn 7h30-11h30 & 13h-17h (T2-T7),
-- tăng ca x1.5 không giới hạn, phép 12 ngày/năm, đi muộn/về sớm chỉ ghi nhận.

-- 1) Hồ sơ nhân viên mở rộng (RLS profiles sẵn có bao phủ cột mới)
alter table public.profiles
  add column if not exists phone text,
  add column if not exists position text, -- chức vụ: Cửa hàng trưởng, Thu ngân, Thợ chính...
  add column if not exists start_date date, -- ngày vào làm (tính thâm niên/phép)
  add column if not exists employment_status text not null default 'active'
    check (employment_status in ('active', 'inactive')); -- nghỉ việc = inactive (giữ lịch sử công)

-- 2) Khóa bảng công theo tháng (YYYY-MM). Tháng đã chốt: không thêm/sửa/xóa công.
create table if not exists public.payroll_locks (
  month text primary key check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  locked_by uuid references public.profiles(id),
  locked_at timestamptz not null default now()
);
alter table public.payroll_locks enable row level security;

drop policy if exists "payroll_locks_read" on public.payroll_locks;
create policy "payroll_locks_read" on public.payroll_locks
  for select to authenticated using (true);

drop policy if exists "payroll_locks_manager_write" on public.payroll_locks;
create policy "payroll_locks_manager_write" on public.payroll_locks
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- 3) Trigger cưỡng chế khóa ở server (UI cũng chặn, đây là lớp thứ hai)
create or replace function public.trg_block_locked_month()
returns trigger language plpgsql as $$
declare
  v_month text;
begin
  if tg_op = 'DELETE' then
    v_month := to_char(old.work_date, 'YYYY-MM');
  else
    v_month := to_char(new.work_date, 'YYYY-MM');
  end if;
  if exists (select 1 from public.payroll_locks where month = v_month) then
    raise exception 'Bảng công tháng % đã chốt lương — liên hệ Admin để mở khóa', v_month;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end; $$;

drop trigger if exists trg_block_locked_month on public.attendance_records;
create trigger trg_block_locked_month
  before insert or update or delete on public.attendance_records
  for each row execute function public.trg_block_locked_month();
