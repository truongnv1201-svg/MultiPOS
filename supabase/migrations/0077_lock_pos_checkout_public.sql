-- Migration 0077 — Khóa pos_checkout khỏi PUBLIC (vá lỗ hổng gọi ẩn danh).
-- Bệnh: mọi bản rewrite pos_checkout (0028->0067) chỉ REVOKE anon mà không REVOKE
-- PUBLIC. Postgres mặc định cấp EXECUTE cho PUBLIC nên anon vẫn gọi trực tiếp được
-- (bài học 0068 đã ghi nhưng pos_checkout nằm ngoài danh sách 0068): ai có URL +
-- anon key (nằm sẵn trong app web) đều tạo được đơn/trừ kho/ghi sổ quỹ mà không
-- cần đăng nhập. Đã kiểm chứng trên production 07/10/2026 (proacl còn '=X').
-- Fix: REVOKE PUBLIC (user đã login không ảnh hưởng vì còn grant authenticated;
-- service_role giữ nguyên cho script vận hành). sync_customer giữ mở cho anon
-- là cố ý (tạo nhanh KH không cần login).
-- LƯU Ý cho lần rewrite pos_checkout sau: CREATE OR REPLACE giữ nguyên ACL này,
-- nhưng DROP + tạo lại sẽ mở lại PUBLIC — lúc đó phải revoke lại.

revoke execute on function public.pos_checkout(text, jsonb, numeric, jsonb, text, numeric, boolean, uuid, numeric, text) from public;
