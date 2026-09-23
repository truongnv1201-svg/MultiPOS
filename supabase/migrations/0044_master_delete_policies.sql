-- Migration 44 — Quyền XÓA master data (Sửa/Xóa Hàng hóa, KH, NCC).
-- Mirror chính sách ghi ở 0036: hàng hóa + NCC chỉ Admin/Quản lý (is_admin bao cả
-- manager); khách hàng mở cho authenticated (khớp insert mở) + client chặn khi
-- còn nợ/còn đơn. FK server (order_items, orders...) tự chặn xóa bản ghi đã dùng.

drop policy if exists "catalog_manager_delete_products" on public.products;
create policy "catalog_manager_delete_products" on public.products
  for delete to authenticated
  using (public.is_admin());

drop policy if exists "catalog_manager_delete_suppliers" on public.suppliers;
create policy "catalog_manager_delete_suppliers" on public.suppliers
  for delete to authenticated
  using (public.is_admin());

drop policy if exists "catalog_authenticated_delete_customers" on public.customers;
create policy "catalog_authenticated_delete_customers" on public.customers
  for delete to authenticated
  using (true);

NOTIFY pgrst, 'reload schema';
