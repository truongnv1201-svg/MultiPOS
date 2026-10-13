-- Migration 84 — Khóa nốt 9 hàm SECURITY DEFINER còn mở cho PUBLIC/anon.
-- audit-rpc-acl.mjs phát hiện sau khi áp 0083 (3 RPC 0083 đã sạch, whitelist anon giữ nguyên).
--
-- Đã rà MỌI đường gọi trực tiếp (2026-10-13), tất cả an toàn với mẫu
-- REVOKE PUBLIC/anon + GRANT authenticated (bài học 0068/0077):
-- - checkout_order / consume_stock_for_order: chỉ gọi NỘI BỘ qua pos_checkout
--   (definer chain — revoke EXECUTE ngoài không ảnh hưởng gọi trong).
-- - open_shift / close_shift: app gọi trực tiếp (shift-stock.tsx) nhưng bắt buộc
--   đã đăng nhập mới mở/đóng ca được — giữ nguyên mọi role, chỉ chặn anon.
-- - generate_order_code / generate_master_code: chỉ server gọi nội bộ +
--   script verify-service.mjs (service_role vượt grant).
-- - order_items_snapshot_cost / trg_fill_stock_movement_balances: trigger
--   SECURITY DEFINER (gọi trực tiếp ngoài trigger vô nghĩa).
-- - rls_auto_enable: event trigger ensure_rls (ddl_command_end) tự bật RLS bảng
--   mới — gọi tay ngoài event chỉ lỗi vô hại, revoke không ảnh hưởng trigger.
-- KHÔNG thêm guard vai trò, KHÔNG đổi thân hàm (chỉ REVOKE/GRANT) nên không
-- đụng logic nghiệp vụ nào; chữ ký lấy nguyên văn pg_get_function_identity_arguments.

REVOKE EXECUTE ON FUNCTION public.checkout_order(UUID, NUMERIC, JSONB, TEXT, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.checkout_order(UUID, NUMERIC, JSONB, TEXT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.checkout_order(UUID, NUMERIC, JSONB, TEXT, NUMERIC) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.consume_stock_for_order(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_stock_for_order(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_stock_for_order(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.open_shift(NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.open_shift(NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_shift(NUMERIC) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.close_shift(UUID, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_shift(UUID, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_shift(UUID, NUMERIC) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.generate_order_code(TEXT, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_order_code(TEXT, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_order_code(TEXT, DATE) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.generate_master_code(TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_master_code(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_master_code(TEXT, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.order_items_snapshot_cost() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.order_items_snapshot_cost() FROM anon;
GRANT EXECUTE ON FUNCTION public.order_items_snapshot_cost() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.trg_fill_stock_movement_balances() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_fill_stock_movement_balances() FROM anon;
GRANT EXECUTE ON FUNCTION public.trg_fill_stock_movement_balances() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO authenticated;

notify pgrst, 'reload schema';
