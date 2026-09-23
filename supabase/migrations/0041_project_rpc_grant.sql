-- Migration 41 — khóa RPC sync_project_workspace theo role (vệ sinh phân quyền).
-- 0040 quên GRANT tường minh: Postgres mặc định cho PUBLIC execute nên anon cũng
-- gọi được. Client luôn yêu cầu đăng nhập trước mọi mutation dự án, nên chỉ giữ
-- authenticated (mirror return_order_items ở 0032).
revoke all on function public.sync_project_workspace(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.sync_project_workspace(uuid, jsonb, jsonb) to authenticated;

NOTIFY pgrst, 'reload schema';
