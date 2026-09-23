-- Migration 34 — công trình còn 3 giai đoạn (gộp xuất kho + chấm công thành Thi công)
-- 1: Báo giá dự toán -> 2: Thi công (vật tư + thợ) -> 3: Nghiệm thu & P&L
-- Remap dữ liệu cũ 1 câu (tránh cập nhật nối tiếp tự ăn nhau): 4->3, 3->2.
-- Giữ CHECK cũ (1-4) + thêm CHECK mới (1-3) = hiệu lực 1-3 mà không cần biết tên constraint cũ.

UPDATE public.projects
SET phase = CASE WHEN phase = 4 THEN 3 WHEN phase = 3 THEN 2 ELSE phase END
WHERE phase IN (3, 4);

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_phase_1_3;
ALTER TABLE public.projects ADD CONSTRAINT projects_phase_1_3 CHECK (phase BETWEEN 1 AND 3);

NOTIFY pgrst, 'reload schema';
