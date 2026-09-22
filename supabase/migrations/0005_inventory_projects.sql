-- Migration 05 — Kho vận, mua hàng, dự án, ca (INV-ERR-03/04, FIN-ERR-04, OFF-ERR-01)

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null,
  product_id uuid references public.products(id),
  quantity numeric(14,3) not null,
  previous_stock numeric(14,3),
  new_stock numeric(14,3),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, -- NH-YYMMDD-XXXX
  supplier_id uuid references public.suppliers(id),
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0, -- FIN-ERR-04: trừ vào phải trả + giá vốn
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  debt_amount numeric(12,2) not null default 0,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, -- CT-YYMMDD-XXXX
  name text not null,
  customer_id uuid references public.customers(id),
  address text,
  phase int not null default 1 check (phase between 1 and 4),
  estimated_revenue numeric(12,2) not null default 0,
  settled_revenue numeric(12,2) not null default 0,
  other_costs numeric(12,2) not null default 0,
  status text not null default 'planning',
  created_at timestamptz not null default now()
);

create table if not exists public.project_materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  product_id uuid references public.products(id),
  quantity numeric(14,3) not null default 1,
  unit_cost numeric(12,2) not null default 0
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  worker_name text not null,
  role text,
  days_worked numeric(6,2) not null default 1,
  daily_wage numeric(12,2) not null default 0,
  allowance numeric(12,2) not null default 0,
  work_date date not null default current_date
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid references public.profiles(id),
  cashier_name text not null,
  branch_id uuid references public.branches(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  starting_cash numeric(12,2) not null default 0,
  status text not null default 'open' check (status in ('open','closed')), -- Invariant #4: closed bất biến
  expected_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2),
  cash_difference numeric(12,2),
  order_count int not null default 0
);

-- INV-ERR-03: xuất vật tư dự án tự trừ kho + ghi movements
create or replace function public.trg_project_material_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stock numeric;
begin
  select stock_quantity into v_stock from public.products where id = new.product_id for update;
  update public.products set stock_quantity = stock_quantity - new.quantity where id = new.product_id;
  if (select stock_quantity from public.products where id = new.product_id) < 0 then
    raise exception 'Tồn kho vật tư dự án không đủ';
  end if;
  insert into public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note)
  values ((select code from public.projects where id = new.project_id), new.product_id, -new.quantity,
    v_stock, v_stock - new.quantity, 'Xuất vật tư dự án P2');
  return new;
end; $$;

drop trigger if exists trg_project_material_stock on public.project_materials;
create trigger trg_project_material_stock
  after insert on public.project_materials
  for each row execute function public.trg_project_material_stock();

-- View P&L công trình: settled - (vật tư + công + khác)
create or replace view public.project_pnl as
select p.id, p.code, p.name, p.settled_revenue,
  coalesce((select sum(quantity*unit_cost) from public.project_materials m where m.project_id=p.id),0) as material_cost,
  coalesce((select sum(days_worked*daily_wage + allowance) from public.attendance_records a where a.project_id=p.id),0) as labor_cost,
  p.other_costs,
  p.settled_revenue - (coalesce((select sum(quantity*unit_cost) from public.project_materials m where m.project_id=p.id),0)
    + coalesce((select sum(days_worked*daily_wage + allowance) from public.attendance_records a where a.project_id=p.id),0)
    + p.other_costs) as profit
from public.projects p;
