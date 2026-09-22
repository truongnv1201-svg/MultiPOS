-- Migration 19 — HRM rebuild từ đầu (gọn cho shop nhỏ)
-- Chốt với user: xóa sạch làm mới, lương ngày + lương tháng song song, chấm điểm danh ngày.
-- Tham khảo MISA AMIS / Base / Tanca / FastWork: employees là master duy nhất,
-- duyệt phép tự sinh công, 1 nút chốt tháng, bảng lương snapshot 1 lần.
--
-- 1) Gỡ trigger + bảng HRM cũ (0014-0018): attendance_records, leave_requests,
--    payroll_runs, payroll_items. Giữ payroll_locks + cashbook_entries (advance).
-- 2) Gỡ cột HR khỏi profiles (daily_wage, phone, position, start_date, employment_status).
-- 3) Tạo schema mới: employees, attendance_days, leave_requests, payroll_runs, payroll_items.

-- 1) Gỡ trigger khóa tháng cũ (kèm guard: bảng cũ có thể đã bị xóa trước đó)
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'attendance_records') then
    drop trigger if exists trg_block_locked_month on public.attendance_records;
  end if;
end $$;
drop function if exists public.trg_block_locked_month();

-- Gỡ bảng cũ (CASCADE dọn policy/trigger/index đi kèm)
drop table if exists public.payroll_items cascade;
drop table if exists public.payroll_runs cascade;
drop table if exists public.leave_requests cascade;
drop table if exists public.attendance_records cascade;
-- Giữ public.payroll_locks (khóa tháng) + cashbook_entries.employee_id/category 'advance'.

-- 2) profiles về tối thiểu (login + phân quyền)
alter table public.profiles drop column if exists daily_wage;
alter table public.profiles drop column if exists phone;
alter table public.profiles drop column if exists position;
alter table public.profiles drop column if exists start_date;
alter table public.profiles drop column if exists employment_status;

-- 3a) Master nhân sự (kể cả thợ tự do không login: user_id nullable)
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- NV0001, cấp ở app
  full_name text not null,
  phone text,
  position text, -- Cửa hàng trưởng, Thu ngân, Thợ chính...
  salary_type text not null default 'daily' check (salary_type in ('daily', 'monthly')),
  daily_wage numeric(12, 2) not null default 0 check (daily_wage >= 0),
  monthly_salary numeric(12, 2) not null default 0 check (monthly_salary >= 0),
  allowance_default numeric(12, 2) not null default 0 check (allowance_default >= 0),
  start_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  user_id uuid unique references public.profiles(id) on delete set null, -- link login (nếu có)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employees enable row level security;

drop policy if exists "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select to authenticated using (true);

drop policy if exists "employees_manager_write" on public.employees;
create policy "employees_manager_write" on public.employees
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create index if not exists idx_employees_status on public.employees (status);

-- 3b) Bảng công ngày (1 người × 1 ngày = 1 dòng)
create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  status text not null default 'present'
    check (status in ('present', 'half', 'leave_paid', 'leave_unpaid', 'holiday')),
  ot_hours numeric(5, 2) not null default 0 check (ot_hours >= 0),
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
alter table public.attendance_days enable row level security;

drop policy if exists "attendance_select" on public.attendance_days;
create policy "attendance_select" on public.attendance_days
  for select to authenticated using (true);

drop policy if exists "attendance_manager_write" on public.attendance_days;
create policy "attendance_manager_write" on public.attendance_days
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create index if not exists idx_attendance_month on public.attendance_days (work_date);

-- 3c) Đơn nghỉ (chỉ 2 loại; OT/muộn chấm thẳng trên lưới công + ghi chú)
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text not null check (type in ('leave_paid', 'leave_unpaid')),
  date_from date not null,
  date_to date not null,
  days numeric(6, 2) not null default 0, -- ngày công nghỉ đã trừ CN
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);
alter table public.leave_requests enable row level security;

drop policy if exists "leave_select" on public.leave_requests;
create policy "leave_select" on public.leave_requests
  for select to authenticated using (true);

drop policy if exists "leave_insert_own" on public.leave_requests;
create policy "leave_insert_own" on public.leave_requests
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "leave_owner_cancel" on public.leave_requests;
create policy "leave_owner_cancel" on public.leave_requests
  for delete to authenticated
  using (created_by = auth.uid() and status = 'pending');

drop policy if exists "leave_manager_all" on public.leave_requests;
create policy "leave_manager_all" on public.leave_requests
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create index if not exists idx_leave_employee_status on public.leave_requests (employee_id, status);

-- 3d) Bảng lương tháng (snapshot 1 lần từ công + hồ sơ)
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  month text not null unique check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'finalized', 'paid')),
  headcount int not null default 0,
  total_days numeric(10, 2) not null default 0,
  total_gross numeric(14, 2) not null default 0,
  total_allowance numeric(14, 2) not null default 0,
  total_deduction numeric(14, 2) not null default 0,
  total_advance numeric(14, 2) not null default 0,
  total_net numeric(14, 2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  paid_at timestamptz
);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null,
  salary_type text not null default 'daily' check (salary_type in ('daily', 'monthly')),
  base_salary numeric(12, 2) not null default 0, -- snapshot daily_wage hoặc monthly_salary
  days numeric(10, 2) not null default 0,
  ot_hours numeric(8, 2) not null default 0,
  gross numeric(14, 2) not null default 0,
  allowance numeric(14, 2) not null default 0,
  deduction numeric(14, 2) not null default 0,
  advance numeric(14, 2) not null default 0,
  note text,
  net numeric(14, 2) not null default 0,
  paid boolean not null default false,
  cashbook_code text
);

alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;

drop policy if exists "payroll_runs_select" on public.payroll_runs;
create policy "payroll_runs_select" on public.payroll_runs
  for select to authenticated using (true);

drop policy if exists "payroll_items_select" on public.payroll_items;
create policy "payroll_items_select" on public.payroll_items
  for select to authenticated using (true);

drop policy if exists "payroll_runs_manager_write" on public.payroll_runs;
create policy "payroll_runs_manager_write" on public.payroll_runs
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "payroll_items_manager_write" on public.payroll_items;
create policy "payroll_items_manager_write" on public.payroll_items
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create index if not exists idx_payroll_items_run on public.payroll_items (run_id);

-- 4) Trigger khóa tháng mới (bám attendance_days + leave auto-ghi cũng bị chặn)
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

drop trigger if exists trg_block_locked_month on public.attendance_days;
create trigger trg_block_locked_month
  before insert or update or delete on public.attendance_days
  for each row execute function public.trg_block_locked_month();
