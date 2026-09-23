-- Migration 47 — Allow authenticated users to insert suppliers (align with customers policy)
drop policy if exists "catalog_manager_insert_suppliers" on public.suppliers;
drop policy if exists "catalog_authenticated_insert_suppliers" on public.suppliers;

create policy "catalog_authenticated_insert_suppliers" on public.suppliers
  for insert to authenticated
  with check (true);
