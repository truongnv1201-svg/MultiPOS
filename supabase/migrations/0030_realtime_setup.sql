-- Migration 0030: Kích hoạt Supabase Realtime cho Báo cáo & Bán hàng
-- 1. Bật REPLICA IDENTITY FULL để payload UPDATE/DELETE chứa đầy đủ dữ liệu
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;
ALTER TABLE public.cashbook_entries REPLICA IDENTITY FULL;
ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER TABLE public.customers REPLICA IDENTITY FULL;

-- 2. Thêm các bảng vào publication supabase_realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cashbook_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cashbook_entries;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
  END IF;
END $$;

-- 3. Đảm bảo quyền SELECT cho anon để WebSocket Realtime không bị chặn bởi RLS
DROP POLICY IF EXISTS "read_all_anon" ON public.orders;
CREATE POLICY "read_all_anon" ON public.orders FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "read_all_anon" ON public.order_items;
CREATE POLICY "read_all_anon" ON public.order_items FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "read_all_anon" ON public.cashbook_entries;
CREATE POLICY "read_all_anon" ON public.cashbook_entries FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "read_all_anon" ON public.customers;
CREATE POLICY "read_all_anon" ON public.customers FOR SELECT TO anon USING (true);
