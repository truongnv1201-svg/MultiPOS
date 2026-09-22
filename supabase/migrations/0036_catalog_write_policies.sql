-- Migration 36 — allow authenticated catalog synchronization with role guards.
-- The browser client writes only with the user's session; service keys are not used.

drop policy if exists "catalog_manager_insert_products" on public.products;
create policy "catalog_manager_insert_products" on public.products
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "catalog_manager_update_products" on public.products;
create policy "catalog_manager_update_products" on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "catalog_authenticated_insert_customers" on public.customers;
create policy "catalog_authenticated_insert_customers" on public.customers
  for insert to authenticated
  with check (true);

drop policy if exists "catalog_authenticated_update_customers" on public.customers;
create policy "catalog_authenticated_update_customers" on public.customers
  for update to authenticated
  using (true)
  with check (current_debt = (select c.current_debt from public.customers c where c.id = customers.id));

drop policy if exists "catalog_read_suppliers" on public.suppliers;
create policy "catalog_read_suppliers" on public.suppliers
  for select to authenticated using (true);

drop policy if exists "catalog_manager_insert_suppliers" on public.suppliers;
create policy "catalog_manager_insert_suppliers" on public.suppliers
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "catalog_manager_update_suppliers" on public.suppliers;
create policy "catalog_manager_update_suppliers" on public.suppliers
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
