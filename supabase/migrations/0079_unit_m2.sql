-- Migration 0079 — Chuẩn hóa đơn vị 'm²' -> 'm2' (dễ nhập liệu/xử lý dữ liệu).
-- App từ nay nhập + hiển thị 'm2'; dữ liệu cũ còn 'm²' thì update 1 lần ở đây
-- (products + order_items). Không đụng logic nào khác (loại hàng diện tích
-- phân biệt bằng product_type, không bằng chuỗi unit).

update public.products set unit = 'm2' where unit = 'm²';
update public.order_items set unit = 'm2' where unit = 'm²';
