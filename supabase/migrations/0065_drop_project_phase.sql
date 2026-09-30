-- Migration 65 — Bỏ hẳn chức năng giai đoạn công trình.
--
-- Vấn đề: cột phase/status của projects chỉ để hiển thị, không điều khiển nghiệp vụ nào.
-- Đã rà toàn bộ code: không RPC nào gate/check phase; không công thức (P&L, tồn kho,
-- thẻ kho, báo cáo) nào dùng nó; UI cũng đã bỏ 3 tab giai đoạn (nơi duy nhất đổi phase).
-- Giữ cột lại chỉ gây hiểu lầm (giai đoạn có thể sai lệch, và nhãn nút "Thu quyết toán"
-- phụ thuộc nó).
--
-- Xoá hẳn 2 cột. Kèm theo: client không còn gửi phase/status trong header upsert
-- (PostgREST báo lỗi cột không tồn tại nếu còn gửi), type Project bỏ 2 trường, Dexie
-- lên version 8 (bỏ index phase/status).
--
-- Lưu ý rollback: cần thì dựng lại cột bằng 0005 (phase int default 1) — nhưng app mới
-- không đọc/ghi chúng nữa nên rollback chỉ có ý nghĩa giữ dữ liệu cũ.

alter table public.projects drop column if exists phase;
alter table public.projects drop column if exists status;

NOTIFY pgrst, 'reload schema';
