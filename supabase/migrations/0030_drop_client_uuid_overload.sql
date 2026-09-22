-- Migration 30 — xóa overload 10-arg lạ trên server (p_client_uuid, không có trong repo)
-- DB đang có 2 bản: 9-arg (repo 0023/0028) + 10-arg (p_client_uuid, tạo tay ngoài repo).
-- Mọi call <=9 args khớp cả 2 qua DEFAULT -> PGRST203. Repo không dùng p_client_uuid
-- nên DROP bản 10-arg, giữ 9-arg làm chuẩn duy nhất.
DROP FUNCTION IF EXISTS public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, UUID);

GRANT EXECUTE ON FUNCTION public.pos_checkout(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
