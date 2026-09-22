-- Branch selection is no longer part of the application runtime.
-- Keep historical branch columns/tables intact, but stop assigning branches
-- automatically to newly created orders.

drop trigger if exists orders_assign_actor_and_branch on public.orders;
drop function if exists public.assign_order_actor_and_branch();
