-- Migration 40 — Đồng bộ Dự án/Công trình 2 chiều (client local-first + server truth).
-- Vấn đề: bảng projects/project_materials có từ 0005 nhưng RLS bật mà KHÔNG có
-- policy nào -> client không đọc/ghi được; thợ (workers) nằm local, chưa có bảng.
-- Thiết kế (mirror catalog: server thắng khi kéo, local thay id server sau khi đẩy):
-- 1) RLS: authenticated đọc hết; ghi mở cho authenticated (màn Dự án không phân quyền,
--    mọi NV đăng nhập đều tạo/sửa công trình — giống style bảng customers ở 0036).
-- 2) project_workers: bảng dòng thợ thi công (attendance_records đã drop ở 0019).
-- 3) Cột trace: projects.customer_name/deposit_amount/updated_at,
--    project_materials.sku/name/unit (giữ truy vết khi product_id chưa map uuid).
-- 4) Bỏ trigger trg_project_material_stock: client trừ kho tại lúc xuất (offline-first);
--    đồng bộ dòng qua RPC sync_project_workspace tính DELTA tồn kho nên chạy lại
--    cùng payload không trừ 2 lần. Server stock khớp để refreshCatalog không revert.

-- 1) Cột trace còn thiếu
alter table public.projects
  add column if not exists customer_name text,
  add column if not exists deposit_amount numeric(12,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.project_materials
  add column if not exists sku text,
  add column if not exists name text,
  add column if not exists unit text;

-- 2) Bảng dòng thợ thi công
create table if not exists public.project_workers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid,
  employee_code text,
  worker_name text not null,
  role text,
  days_worked numeric(10,3) not null default 0,
  daily_wage numeric(12,2) not null default 0,
  allowance numeric(12,2) not null default 0
);
alter table public.project_workers enable row level security;
create index if not exists idx_project_workers_project on public.project_workers(project_id);

-- 3) RLS policies (drop-if-exists để chạy lại an toàn)
drop policy if exists "projects_read" on public.projects;
create policy "projects_read" on public.projects
  for select to authenticated using (true);
drop policy if exists "projects_write" on public.projects;
create policy "projects_write" on public.projects
  for all to authenticated using (true) with check (true);

drop policy if exists "project_materials_read" on public.project_materials;
create policy "project_materials_read" on public.project_materials
  for select to authenticated using (true);
drop policy if exists "project_materials_write" on public.project_materials;
create policy "project_materials_write" on public.project_materials
  for all to authenticated using (true) with check (true);

drop policy if exists "project_workers_read" on public.project_workers;
create policy "project_workers_read" on public.project_workers
  for select to authenticated using (true);
drop policy if exists "project_workers_write" on public.project_workers;
create policy "project_workers_write" on public.project_workers
  for all to authenticated using (true) with check (true);

-- 4) Bỏ trigger trừ kho trực tiếp (xung đột double-deduct với client offline-first).
-- Thay bằng RPC sync_project_workspace bên dưới (delta + atomic).
drop trigger if exists trg_project_material_stock on public.project_materials;
drop function if exists public.trg_project_material_stock();

-- 5) RPC đồng bộ dòng vật tư + thợ theo DELTA (idempotent: chạy lại cùng
-- payload không đổi tồn kho). p_materials: [{product_id, sku, name, quantity,
-- unit, unit_cost}], p_workers: [{employee_id, employee_code, worker_name,
-- role, days_worked, daily_wage, allowance}]. product_id/employee_id khác uuid
-- -> null (giữ sku/name truy vết).
create or replace function public.sync_project_workspace(
  p_project_id uuid,
  p_materials jsonb,
  p_workers jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  m jsonb;
  w jsonb;
  v_pid uuid;
  v_stock numeric;
  rec record;
begin
  -- Vật tư: gom payload theo product_id (1 vật tư có thể xuất nhiều dòng),
  -- delta = mới - cũ trên FULL OUTER JOIN (dòng bị gỡ ở client -> delta âm -> hoàn kho).
  -- Chạy lại cùng payload -> delta 0 -> không đổi tồn kho (idempotent).
  create temporary table _pw_new on commit drop as
  select ((mm->>'product_id')::uuid) as pid, sum(coalesce((mm->>'quantity')::numeric, 0)) as qty
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) mm
  where (mm->>'product_id') ~ '^[0-9a-fA-F-]{36}$'
  group by 1;

  create temporary table _pw_old on commit drop as
  select product_id as pid, sum(quantity) as qty
  from public.project_materials
  where project_id = p_project_id and product_id is not null
  group by 1;

  for rec in
    select coalesce(n.pid, o.pid) as pid, coalesce(n.qty, 0) - coalesce(o.qty, 0) as delta
    from _pw_new n full outer join _pw_old o on o.pid = n.pid
  loop
    if rec.delta <> 0 then
      select stock_quantity into v_stock from public.products where id = rec.pid for update;
      if v_stock is null then
        raise exception 'Vật tư không tồn tại %', rec.pid;
      end if;
      if v_stock - rec.delta < 0 then
        raise exception 'Tồn kho vật tư không đủ';
      end if;
      update public.products set stock_quantity = stock_quantity - rec.delta where id = rec.pid;
      insert into public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note)
      values ((select code from public.projects where id = p_project_id), rec.pid, -rec.delta,
        v_stock, v_stock - rec.delta,
        case when rec.delta > 0 then 'Đồng bộ vật tư công trình' else 'Hoàn kho vật tư công trình bị gỡ' end);
    end if;
  end loop;

  -- Replace toàn bộ dòng vật tư (giữ nguyên từng dòng client, kể cả trùng vật tư)
  delete from public.project_materials where project_id = p_project_id;
  for m in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
    v_pid := null;
    if (m->>'product_id') ~ '^[0-9a-fA-F-]{36}$' then
      v_pid := (m->>'product_id')::uuid;
    end if;
    insert into public.project_materials (project_id, product_id, sku, name, quantity, unit, unit_cost)
    values (p_project_id, v_pid, m->>'sku', m->>'name',
      coalesce((m->>'quantity')::numeric, 0), m->>'unit', coalesce((m->>'unit_cost')::numeric, 0));
  end loop;

  -- Replace toàn bộ dòng thợ (không ảnh hưởng kho)
  delete from public.project_workers where project_id = p_project_id;
  for w in select * from jsonb_array_elements(coalesce(p_workers, '[]'::jsonb)) loop
    insert into public.project_workers (project_id, employee_id, employee_code, worker_name, role, days_worked, daily_wage, allowance)
    values (p_project_id,
      case when w->>'employee_id' ~ '^[0-9a-fA-F-]{36}$' then (w->>'employee_id')::uuid else null end,
      w->>'employee_code', w->>'worker_name', w->>'role',
      coalesce((w->>'days_worked')::numeric, 0), coalesce((w->>'daily_wage')::numeric, 0), coalesce((w->>'allowance')::numeric, 0));
  end loop;

  update public.projects set updated_at = now() where id = p_project_id;
end; $$;

NOTIFY pgrst, 'reload schema';
