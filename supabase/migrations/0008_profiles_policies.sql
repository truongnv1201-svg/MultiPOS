-- Migration 08 — Auth: profiles tự đọc + admin quản trị (SEC-ERR-02/03 bổ sung)
-- RLS đã bật ở 0006 nhưng profiles chưa có policy nào -> authenticated không đọc được chính mình.

DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "branches_read" ON public.branches;
CREATE POLICY "branches_read" ON public.branches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "branches_read_anon" ON public.branches;
CREATE POLICY "branches_read_anon" ON public.branches FOR SELECT TO anon USING (true);
