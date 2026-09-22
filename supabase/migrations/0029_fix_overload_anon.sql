-- Migration 29 — fix PGRST203 sau 0028 + tương thích verify anon
-- Nguyên nhân: 0007 còn overload 7-arg, 0023/0028 dùng 9-arg có DEFAULT -> call 7-arg
-- khớp cả 2 -> PostgREST PGRST203. 0028 lại REVOKE anon ở bản 9-arg nên verify anon càng gãy.
-- Fix:
-- 1) DROP overload 7-arg cũ (0007) — mọi caller dùng bản 9-arg (DEFAULT lo tương thích).
-- 2) Mở lại anon cho bản 9-arg để verify + POS chưa login vẫn checkout được như trước;
--    chống giá 1đ bằng guard server (đơn giá > 0, đã có guard nợ vô chủ + trừ kho).
-- 3) Reload PostgREST schema cache để hết ambiguous ngay.

DROP FUNCTION IF EXISTS public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN);

GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
