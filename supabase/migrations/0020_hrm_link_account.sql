-- Migration 20 — Gộp nhân sự thành một: mỗi hồ sơ employees gắn 1 tài khoản đăng nhập.
-- 1) profiles thêm cột email (hiển thị để phân biệt tài khoản khi gắn vào hồ sơ).
-- 2) Backfill email từ auth.users cho tài khoản cũ (chạy bằng quyền postgres).
-- 3) employees.user_id giữ nullable ở DB (tránh kẹt migration nếu đã có dữ liệu),
--    app cưỡng chế: NV mới bắt buộc tạo/gắn tài khoản; NV cũ hiện badge "chưa gắn".

alter table public.profiles add column if not exists email text;

-- Backfill best-effort (bỏ qua nếu không đọc được auth.users)
do $$
begin
  update public.profiles p
  set email = u.email
  from auth.users u
  where u.id = p.id and (p.email is null or p.email = '');
exception when others then
  raise notice 'backfill profiles.email skipped: %', sqlerrm;
end $$;

-- RLS profiles sẵn có bao phủ cột mới (select own/manager, write admin/manager).
