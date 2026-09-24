-- 0052: Hạn mức công nợ nhà cung cấp (credit_limit).
-- Báo cáo công nợ phải trả NCC đã hiển thị cột "Hạn mức", nhưng bảng suppliers
-- chưa có cột này -> thêm để Danh mục NCC nhập/lưu/đồng bộ hạn mức được.
-- null / 0 = không giới hạn (mirror customers.debt_limit semantics).
alter table public.suppliers add column if not exists credit_limit numeric(12,2);

comment on column public.suppliers.credit_limit is
  'Han muc cong no NCC; null/0 = khong gioi han';
