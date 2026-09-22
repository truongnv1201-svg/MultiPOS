-- Đồng bộ cấu hình cửa hàng và biến chi nhánh làm việc thành dữ liệu dùng chung.

insert into public.branches (name, address)
select 'Chi nhánh 1 (Tổng kho)', null
where not exists (select 1 from public.branches);

update public.profiles
set branch_id = (select id from public.branches order by created_at, id limit 1)
where branch_id is null;

create or replace function public.assign_order_actor_and_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.cashier_id := coalesce(new.cashier_id, auth.uid());
    new.branch_id := coalesce(
      new.branch_id,
      (select branch_id from public.profiles where id = auth.uid())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_assign_actor_and_branch on public.orders;
create trigger orders_assign_actor_and_branch
before insert on public.orders
for each row execute function public.assign_order_actor_and_branch();
