-- Migration 46 — P2.3: enforce customer debt quota atomically on checkout.
-- A zero limit means unlimited, matching the existing customer settings UI.

DROP POLICY IF EXISTS "combo_items_read_authenticated" ON public.combo_items;
CREATE POLICY "combo_items_read_authenticated"
  ON public.combo_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "combo_items_read_anon" ON public.combo_items;
CREATE POLICY "combo_items_read_anon"
  ON public.combo_items FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "combo_items_manager_write" ON public.combo_items;
CREATE POLICY "combo_items_manager_write"
  ON public.combo_items FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.enforce_customer_debt_limit()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_limit NUMERIC;
BEGIN
  v_limit := COALESCE(NEW.debt_limit, 0);
  IF v_limit > 0 AND COALESCE(NEW.current_debt, 0) > v_limit THEN
    RAISE EXCEPTION 'Khách hàng đã vượt hạn mức nợ (% / %)',
      NEW.current_debt, v_limit;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_debt_limit_guard ON public.customers;
CREATE TRIGGER customer_debt_limit_guard
  BEFORE INSERT OR UPDATE OF current_debt, debt_limit ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_debt_limit();

NOTIFY pgrst, 'reload schema';
