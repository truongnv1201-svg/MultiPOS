-- Migration 49 — Bật realtime đa máy trạm (P0-sync tức thì).
-- Publication supabase_realtime mặc định của Supabase đang trống (bản refactor
-- đã bỏ file realtime cũ) nên client chỉ hội tụ bằng poll 15s. ADD 10 bảng
-- nghiệp vụ vào publication; RLS SELECT đã mở (anon/authenticated) nên event
-- đẩy được ngay, không cần sửa policy. Mọi bảng đều có PK nên replica identity
-- mặc định đủ cho UPDATE/DELETE. Client subscribe channel 'multipos-live'
-- (debounce 800ms rồi gọi lại các hàm refresh có sẵn).
-- Idempotent: chạy lại không lỗi.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'orders', 'order_items', 'cashbook_entries', 'products', 'customers',
    'suppliers', 'combo_items', 'stock_movements', 'purchase_orders', 'shifts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
