-- Migration 37 — expose server stock movements to authenticated inventory screens.

drop policy if exists "stock_movements_read_authenticated" on public.stock_movements;
create policy "stock_movements_read_authenticated" on public.stock_movements
  for select to authenticated using (true);

create or replace function public.trg_fill_stock_movement_balances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
begin
  if new.product_id is not null and (new.previous_stock is null or new.new_stock is null) then
    select stock_quantity into v_stock
    from public.products
    where id = new.product_id;

    if v_stock is not null then
      new.new_stock := coalesce(new.new_stock, v_stock);
      new.previous_stock := coalesce(new.previous_stock, v_stock - new.quantity);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_stock_movement_balances on public.stock_movements;
create trigger trg_fill_stock_movement_balances
before insert on public.stock_movements
for each row execute function public.trg_fill_stock_movement_balances();
