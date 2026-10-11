-- Migration 0080 — Cờ ngừng kinh doanh sản phẩm (xóa mềm thay cho xóa cứng).
-- Bệnh: hàng tạo nhầm có tồn/lịch sử thì nút Xóa bị chặn (3 chốt client + 5 FK
-- server), mà xóa cứng cũng không xong: sync danh mục giữ dòng local vắng trên
-- server nên hàng sẽ sống lại ở máy khác, lịch sử chứng từ thì thủng.
-- Fix: thêm cột is_active (mặc định true). Tắt cờ thì hàng biến khỏi POS/tìm kiếm
-- và báo cáo tồn, nhưng lịch sử đơn/thẻ kho/công trình giữ nguyên; bật lại được.
-- Sửa/xóa catalog vốn đã chặn is_admin() server-side nên toggle theo đó.
-- Không đụng logic nào khác.

alter table public.products add column if not exists is_active boolean not null default true;
