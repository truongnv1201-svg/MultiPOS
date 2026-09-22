-- Migration 02 — Master data + trigger avg_cost (INT-ERR-01)
-- Bao phủ: branches, profiles, products, product_variants, combo_items, customers, suppliers, grinding_services

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'cashier' check (role in ('admin','manager','cashier','worker')),
  branch_id uuid references public.branches(id),
  created_at timestamptz not null default now()
);

create table if not exists public.grinding_services (
  id text primary key, -- none | xiet_bong | huynh_vat | mo_vit | luc_giac
  label text not null,
  price_per_md numeric(12,2) not null default 0
);
insert into public.grinding_services (id, label, price_per_md) values
  ('none','Không mài / Cắt thô',0),
  ('xiet_bong','Mài xiết bóng',20000),
  ('huynh_vat','Mài huỳnh vát cạnh',35000),
  ('mo_vit','Mài mỏ vịt bo tròn',30000),
  ('luc_giac','Mài 45 độ ghép góc',40000)
on conflict (id) do nothing;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null, -- SP000001 via generate_master_code
  barcode text unique,
  name text not null,
  category text not null default 'Chung',
  unit text not null default 'cái',
  product_type text not null default 'goods' check (product_type in ('goods','area','combo','service')),
  retail_price numeric(12,2) not null default 0,
  trade_price numeric(12,2),
  import_price numeric(12,2) not null default 0,
  avg_cost numeric(12,2) not null default 0, -- INT-ERR-01: trigger gán = import_price nếu 0
  stock_quantity numeric(14,3) not null default 0 check (stock_quantity >= 0), -- Invariant #2
  min_stock numeric(14,3) default 0,
  waste_factor numeric(5,2) default 0,
  default_grinding_price numeric(12,2) default 0,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text unique not null,
  name text not null,
  stock_quantity numeric(14,3) not null default 0 check (stock_quantity >= 0),
  price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Combo cha không giữ tồn, trừ linh kiện con (INV-ERR-02)
create table if not exists public.combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_product_id uuid not null references public.products(id) on delete cascade,
  child_product_id uuid not null references public.products(id) on delete restrict,
  child_sku text not null,
  quantity numeric(14,3) not null default 1,
  unique (combo_product_id, child_product_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  phone text,
  address text,
  customer_group text not null default 'retail' check (customer_group in ('retail','contractor','wholesale')),
  current_debt numeric(12,2) not null default 0 check (current_debt >= 0), -- Invariant #3
  debt_limit numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  phone text,
  address text,
  tax_code text,
  current_debt numeric(12,2) not null default 0 check (current_debt >= 0),
  created_at timestamptz not null default now()
);

-- INT-ERR-01: khởi tạo avg_cost = import_price khi insert/update để 0
create or replace function public.trg_init_variant_avg_cost()
returns trigger language plpgsql as $$
begin
  if new.avg_cost is null or new.avg_cost = 0 then
    new.avg_cost := coalesce(new.import_price, 0);
  end if;
  return new;
end; $$;

drop trigger if exists trg_init_variant_avg_cost on public.products;
create trigger trg_init_variant_avg_cost
  before insert or update on public.products
  for each row execute function public.trg_init_variant_avg_cost();
