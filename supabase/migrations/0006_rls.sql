-- Migration 06 — RLS + RBAC (SEC-ERR-02..04)
-- Thu ngân: cấm sửa nợ/hạn mức qua REST; chấm công chỉ admin; ảnh public-read cho authenticated

alter table public.settings enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.grinding_services enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.combo_items enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.cashbook_entries enable row level security;
alter table public.stock_movements enable row level security;
alter table public.projects enable row level security;
alter table public.project_materials enable row level security;
alter table public.attendance_records enable row level security;
alter table public.shifts enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','manager'));
$$;

-- Đọc chung cho authenticated (POS cần tốc độ <3s)
drop policy if exists "read_all_authenticated" on public.products;
create policy "read_all_authenticated" on public.products for select to authenticated using (true);
drop policy if exists "read_all_authenticated" on public.customers;
create policy "read_all_authenticated" on public.customers for select to authenticated using (true);
drop policy if exists "read_all_authenticated" on public.orders;
create policy "read_all_authenticated" on public.orders for select to authenticated using (true);
drop policy if exists "read_all_authenticated" on public.order_items;
create policy "read_all_authenticated" on public.order_items for select to authenticated using (true);

-- SEC-ERR-02: thu ngân chỉ UPDATE customers khi KHÔNG đổi current_debt/debt_limit
drop policy if exists "cashier_update_customer_guarded" on public.customers;
create policy "cashier_update_customer_guarded" on public.customers
  for update to authenticated
  with check (current_debt = (select c.current_debt from public.customers c where c.id = customers.id));

-- SEC-ERR-03: chấm công chỉ admin/manager
drop policy if exists "attendance_admin_write" on public.attendance_records;
create policy "attendance_admin_write" on public.attendance_records
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "attendance_read" on public.attendance_records;
create policy "attendance_read" on public.attendance_records for select to authenticated using (true);

-- Ghi đơn/quỹ qua RPC SECURITY DEFINER nên khóa insert trực tiếp từ client:
-- client chỉ được insert orders ở trạng thái pending, mọi tính tiền do RPC
drop policy if exists "insert_pending_order" on public.orders;
create policy "insert_pending_order" on public.orders
  for insert to authenticated with check (status = 'pending');
