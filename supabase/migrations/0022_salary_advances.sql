-- Migration 22 — Model tạm ứng lương tử tế (user chốt).
-- Trước đây tạm ứng chỉ là số nhập tay trên dòng lương, không chứng từ, không đối chiếu được.
-- Chốt mới: mỗi lần ứng là 1 bản ghi salary_advances (kèm phiếu chi category 'advance'
-- trong sổ quỹ); lập bảng lương tự cộng dồn theo (nhân viên, tháng).

create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  fund_type text not null default 'cash' check (fund_type in ('cash', 'bank')),
  advance_date date not null,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'), -- tháng lương sẽ khấu trừ
  note text,
  cashbook_code text, -- mã phiếu chi tương ứng trong sổ quỹ
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.salary_advances enable row level security;

drop policy if exists "advances_select" on public.salary_advances;
create policy "advances_select" on public.salary_advances
  for select to authenticated using (true);

drop policy if exists "advances_manager_write" on public.salary_advances;
create policy "advances_manager_write" on public.salary_advances
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create index if not exists idx_advances_employee_month on public.salary_advances (employee_id, month);
