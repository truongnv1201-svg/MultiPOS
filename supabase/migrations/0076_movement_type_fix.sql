-- Migration 0076 — Thẻ kho phân loại đúng thật (sửa 0072 không có hiệu lực).
-- Bệnh (đo trên production 07/10/2026): mọi dòng HD (bán/trả) và CT (xuất công trình)
-- đều lưu movement_type = 'import' -> Thẻ kho hiện "Nhập kho" cho phiếu bán.
-- Hai nguyên nhân chồng nhau:
--   1. 0064 đặt DEFAULT 'import' cho cột. Postgres điền DEFAULT TRƯỚC khi BEFORE
--      trigger chạy, nên trigger 0072 thấy cột đã có giá trị và bỏ qua; backfill
--      0072 (where movement_type is null) cũng không khớp dòng nào vì cột NOT NULL.
--   2. 0072 thực tế chưa từng được áp lên production (không có trigger/function).
-- Fix:
--   - Bỏ DEFAULT (giữ NOT NULL): RPC nào không ghi loại thì trigger tự điền; RPC ghi
--     loại thật (0064 adjust_stock, 0071+ sync_stock_import) vẫn được tôn trọng.
--   - Tạo lại function + trigger phân loại y luật 0072 (idempotent).
--   - Sửa dữ liệu cũ: dòng đang 'import' mà mã phiếu KHÔNG phải NH -> phân loại lại
--     theo cùng luật (NH là nhập kho thật, không đụng).

alter table public.stock_movements alter column movement_type drop default;

create or replace function public.stock_movements_classify()
returns trigger language plpgsql as $$
begin
  if NEW.movement_type is not null then
    return NEW;
  end if;
  NEW.movement_type :=
    case
      when NEW.reference_code like 'NH-%' then 'import'
      when NEW.reference_code like 'CT-%' then 'export_project'
      when NEW.reference_code like 'PQ-%'
        then case when coalesce(NEW.quantity, 0) < 0 then 'adjust_loss' else 'adjust_gain' end
      when NEW.reference_code like 'HD-%'
        then case when coalesce(NEW.quantity, 0) < 0 then 'export_sales' else 'return' end
      else case when coalesce(NEW.quantity, 0) < 0 then 'export_sales' else 'import' end
    end;
  return NEW;
end; $$;

drop trigger if exists trg_stock_movements_classify on public.stock_movements;
create trigger trg_stock_movements_classify
before insert on public.stock_movements
for each row execute function public.stock_movements_classify();

update public.stock_movements
set movement_type =
  case
    when reference_code like 'CT-%' then 'export_project'
    when reference_code like 'PQ-%'
      then case when coalesce(quantity, 0) < 0 then 'adjust_loss' else 'adjust_gain' end
    when reference_code like 'HD-%'
      then case when coalesce(quantity, 0) < 0 then 'export_sales' else 'return' end
    else case when coalesce(quantity, 0) < 0 then 'export_sales' else 'import' end
  end
where movement_type = 'import'
  and reference_code not like 'NH-%';
