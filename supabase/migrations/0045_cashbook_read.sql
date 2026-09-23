-- Migration 45 — Sổ quỹ đa máy hội tụ (chỉ đọc).
-- cashbook_entries bật RLS từ 0006 nhưng ZERO policy -> REST deny-all: mỗi máy giữ
-- sổ local riêng, không bao giờ thấy bút toán máy khác. Mở SELECT cho authenticated
-- để client kéo về đối soát. GHI vẫn khóa: chỉ RPC SECURITY DEFINER được insert
-- (chống sửa tay) — client không bao giờ update/delete trực tiếp bảng này.

drop policy if exists "cashbook_read" on public.cashbook_entries;
create policy "cashbook_read" on public.cashbook_entries
  for select to authenticated using (true);

NOTIFY pgrst, 'reload schema';
