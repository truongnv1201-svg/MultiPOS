-- Migration 10 — Cấu hình thương mại: settings/grinding đọc công khai, ghi chỉ admin
-- UI Settings (giá mài, làm tròn) gọi REST trực tiếp khi login admin/manager.

-- settings: anon + authenticated được đọc (cấu hình vô hại)
DROP POLICY IF EXISTS "settings_read" ON public.settings;
CREATE POLICY "settings_read" ON public.settings
  FOR SELECT TO anon, authenticated USING (true);

-- settings: chỉ admin/manager được ghi
DROP POLICY IF EXISTS "settings_admin_write" ON public.settings;
CREATE POLICY "settings_admin_write" ON public.settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- grinding_services: chỉ admin/manager được ghi (đọc anon đã có từ 0007)
DROP POLICY IF EXISTS "grinding_admin_write" ON public.grinding_services;
CREATE POLICY "grinding_admin_write" ON public.grinding_services
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
