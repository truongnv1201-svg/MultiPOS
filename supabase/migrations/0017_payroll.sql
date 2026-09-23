-- LƯU Ý LỊCH SỬ (P2): file này đã apply trên server từ trước đợt rebuild HRM (0019/0021).
-- KHÔNG chạy lại full bộ apply-migrations.mjs — file này FAIL khi rerun trên schema hiện tại
-- (tham chiếu cột/bảng đã bị 0019/0021 thay thế). Muốn apply đơn lẻ file mới thì dùng
-- scripts/apply-one.mjs <file>. Giữ nguyên nội dung bên dưới, chỉ để tra cứu.
-- Migration 17 — Giai đoạn 3 HRM: bảng lương chốt từ bảng công, chi qua sổ quỹ
-- Luồng: manager tạo nháp từ bảng công tháng -> sửa tạm ứng/khấu trừ ->
-- Chốt (draft->finalized, tự khóa tháng) -> Chi lương (finalized->paid, sinh phiếu chi
-- category 'labor' trong sổ quỹ) -> Mở lại (finalized->draft + mở khóa) khi cần sửa.

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
  user_id uuid references public.profiles(id) on delete set null,
  worker_name text not null,
  position text,
  daily_wage numeric(12, 2) not null default 0,
  days numeric(10, 2) not null default 0,
  ot_hours numeric(8, 2) not null default 0,
  gross numeric(14, 2) not null default 0, -- lương công + TC (từ bảng công)
  allowance_extra numeric(14, 2) not null default 0, -- phụ cấp thêm do quản lý nhập
  deduction numeric(14, 2) not null default 0, -- khấu trừ khác
  advance numeric(14, 2) not null default 0, -- tạm ứng đã nhận
  note text,
  net numeric(14, 2) not null default 0, -- gross + allowance_extra - deduction - advance
  paid boolean not null default false,
  cashbook_code text
);

alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;

-- Đọc: đơn của mình (phiếu lương tự tra) + quản lý đọc hết
drop policy if exists "payroll_runs_select" on public.payroll_runs;
create policy "payroll_runs_select" on public.payroll_runs
  for select to authenticated using (true);

drop policy if exists "payroll_items_select" on public.payroll_items;
create policy "payroll_items_select" on public.payroll_items
  for select to authenticated
  using (user_id = auth.uid() or public.is_manager());

-- Ghi: chỉ quản lý (lập/chốt/chi/mở lại)
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
