-- Migration 18 — Tạm ứng lương đúng nghiệp vụ: phiếu chi riêng trong sổ quỹ, bảng lương tự cộng dồn
-- Trước đây tạm ứng ghi chung category 'labor' (lẫn với chi lương), bảng lương nhập tay lại.
-- Chốt mới: category 'advance' + employee_id + reference TAMUNG-YYYY-MM;
-- lập bảng lương tự cộng dồn tạm ứng theo (nhân viên, tháng).

alter table public.cashbook_entries
  add column if not exists employee_id uuid references public.profiles(id) on delete set null;

-- Mở rộng check category (tên constraint mặc định của Postgres)
alter table public.cashbook_entries drop constraint if exists cashbook_entries_category_check;
alter table public.cashbook_entries
  add constraint cashbook_entries_category_check
  check (category in ('sales','deposit','debt_collection','supplier_payment','labor','material','advance','other'));
