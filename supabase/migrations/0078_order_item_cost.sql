-- Migration 0078 — Chụp vốn (MAC) vào từng dòng đơn lúc bán.
-- Bệnh: order_items không có cột vốn nên lãi kỳ cũ phải lấy MAC hôm nay áp ngược
-- cho đơn cũ (MAC đổi mỗi lần nhập) — kỳ càng xa càng ước tính.
-- Fix: thêm cột unit_cost (mặc định 0 để dòng cũ/client cũ không gãy) + trigger
-- BEFORE INSERT tự điền avg_cost tại thời điểm ghi dòng khi lệnh ghi không đưa
-- vốn lên. Dùng trigger thay vì sửa body pos_checkout (260 dòng, dễ chép sai) —
-- trigger sống sót qua mọi lần rewrite RPC sau này và bắt mọi đường ghi dòng.
-- Từ đây lãi mọi kỳ về sau là chính xác tuyệt đối; kỳ trước (unit_cost = 0)
-- vẫn fallback MAC như cũ. Không đổi signature RPC nào.

alter table public.order_items add column if not exists unit_cost numeric(12,2) not null default 0;

create or replace function public.order_items_snapshot_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Chỉ điền khi lệnh ghi không đưa vốn (0/NULL): tôn trọng giá trị ghi rõ.
  if NEW.unit_cost is null or NEW.unit_cost = 0 then
    select coalesce(p.avg_cost, 0) into NEW.unit_cost
    from public.products p where p.id = NEW.product_id;
    NEW.unit_cost := coalesce(NEW.unit_cost, 0);
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_order_items_snapshot_cost on public.order_items;
create trigger trg_order_items_snapshot_cost
before insert on public.order_items
for each row execute function public.order_items_snapshot_cost();
