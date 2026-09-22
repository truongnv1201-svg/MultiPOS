-- Migration 31 — P1-1: vá RLS customers (cashier sửa được debt_limit)
-- Lỗ hổng 0006: policy cashier_update_customer_guarded chỉ check current_debt,
-- thiếu debt_limit + thiếu USING -> thu ngân nâng hạn mức qua REST được.
-- Fix: 2 policy OR nhau —
--   1) admin/manager (is_admin) được update mọi cột
--   2) staff chỉ được update khi GIỮ NGUYÊN cả current_debt + debt_limit
-- RPC SECURITY DEFINER (pos_checkout/collect_debt/...) chạy quyền owner nên không bị chặn.

DROP POLICY IF EXISTS "cashier_update_customer_guarded" ON public.customers;

-- 1) Admin/Manager full update
DROP POLICY IF EXISTS "customers_admin_update" ON public.customers;
CREATE POLICY "customers_admin_update" ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2) Staff guarded: tên/SĐT/địa chỉ được sửa, 2 cột nợ/hạn mức phải giữ nguyên
DROP POLICY IF EXISTS "customers_staff_update_guarded" ON public.customers;
CREATE POLICY "customers_staff_update_guarded" ON public.customers
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    current_debt = (SELECT c.current_debt FROM public.customers c WHERE c.id = customers.id)
    AND debt_limit = (SELECT c.debt_limit FROM public.customers c WHERE c.id = customers.id)
  );

NOTIFY pgrst, 'reload schema';
