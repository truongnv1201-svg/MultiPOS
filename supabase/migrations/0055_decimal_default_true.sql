-- 0055: MẶC ĐỊNH cho phép bán số lượng thập phân.
--
-- 0054 mới tạo cờ với default false (an toàn cho hàng đếm theo cái). Yêu cầu thực tế:
-- mặc định ĐƯỢC nhập số lượng thập phân (2,15 kg) cho mọi mặt hàng; muốn hàng đếm
-- theo cái/bao thì tắt cờ trong Bảng giá.
--
-- Vì vậy: đổi default của cột + backfill toàn bộ mặt hàng hiện có (kể cả hàng m² vốn
-- đã luôn tính thập phân) để dữ liệu cũ khớp với hành vi mới ngay lập tức.

alter table public.products
  alter column allow_decimal set default true;

update public.products set allow_decimal = true where allow_decimal = false;

comment on column public.products.allow_decimal is
  'Cho phép nhập số lượng thập phân khi bán/nhập (vd 2,15 kg). Mặc định true; tắt (false) cho mặt hàng đếm theo cái/bao.';
