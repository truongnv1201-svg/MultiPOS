-- Migration 0072 — Thẻ kho tự gắn loại đúng (không đoán bằng regex nữa).
-- Bệnh: mọi RPC ghi stock_movements (bán/trả/xuất CT) đều bỏ trống movement_type,
-- client phải đoán bằng regex trên note -> đơn bán HD hiện nhãn "Nhập kho".
-- Chỉ 0064 (điều chỉnh) và 0071 (nhập) ghi loại thật.
-- Fix: trigger BEFORE INSERT tự gắn loại theo mã phiếu + dấu số lượng
-- (quy ước mã: NH=nhập, HD=đơn bán, CT=công trình, PQ=điều chỉnh),
-- rồi backfill cùng 1 luật cho dòng cũ. Client đã ưu tiên đọc cột (0064).
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

-- Backfill dòng cũ NULL bằng đúng luật trên (không đụng dòng đã có loại).
update public.stock_movements
set movement_type =
  case
    when reference_code like 'NH-%' then 'import'
    when reference_code like 'CT-%' then 'export_project'
    when reference_code like 'PQ-%'
      then case when coalesce(quantity, 0) < 0 then 'adjust_loss' else 'adjust_gain' end
    when reference_code like 'HD-%'
      then case when coalesce(quantity, 0) < 0 then 'export_sales' else 'return' end
    else case when coalesce(quantity, 0) < 0 then 'export_sales' else 'import' end
  end
where movement_type is null;
