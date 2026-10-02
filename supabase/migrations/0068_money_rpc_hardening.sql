-- Migration 68 — Siết quyền gọi RPC tiền/nợ + bỏ policy thừa.
--
-- 1) cancel_order / return_order_items / collect_debt là RPC SECURITY DEFINER
--    (vượt RLS). Trước đây chỉ GRANT cho authenticated mà KHÔNG revoke PUBLIC/anon —
--    Postgres mặc định cấp EXECUTE cho PUBLIC nên tài khoản anon vẫn gọi trực tiếp
--    được (hủy đơn, hoàn tiền, thu nợ) nếu đoán được UUID. Khóa theo chuẩn 0063/0064:
--    REVOKE cả PUBLIC lẫn anon, chỉ authenticated được gọi (client đã bắt login).
--    sync_customer giữ nguyên cho anon (tạo nhanh KH không cần login, cố ý).
-- 2) Bỏ policy insert_pending_order trên orders: cho phép mọi authenticated INSERT
--    đơn tuỳ ý, vượt price-guard của pos_checkout — mà không luồng client nào dùng
--    (offline dùng bảng Dexie pendingOrders, checkout đi RPC). Bỏ để khỏi cửa sau.

-- 1) Siết RPC tiền/nợ
REVOKE EXECUTE ON FUNCTION public.cancel_order(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_order(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.return_order_items(UUID, NUMERIC, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.collect_debt(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.collect_debt(UUID, NUMERIC, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.collect_debt(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- 2) Bỏ policy insert trực tiếp đơn (không luồng nào dùng)
DROP POLICY IF EXISTS "insert_pending_order" ON public.orders;
