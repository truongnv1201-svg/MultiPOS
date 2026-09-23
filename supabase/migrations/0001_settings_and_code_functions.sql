-- Migration 01 — SRS §2.1 + vá SQL-ERR-01 / SEC-ERR-01 / NEW-CONF-05
-- Bảng settings: nguồn sequence cho mã chứng từ + cấu hình cash_rounding
-- Quy ước: generate_order_code cho giao dịch (HD,TH,NH,CT,PQ,PT,PC),
--           generate_master_code cho SKU (SP000001...)

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Mặc định làm tròn tiền mặt 500đ (NEW-CONF-03: chỉ áp khi method='cash')
insert into public.settings (key, value)
values ('cash_rounding', jsonb_build_object('denominator', 500))
on conflict (key) do nothing;

-- Hàm sinh mã chứng từ giao dịch: HD-YYMMDD-XXXX (vá SQL-ERR-01: ON CONFLICT)
create or replace function public.generate_order_code(prefix text, p_date date default current_date)
returns text
language plpgsql
security definer -- vá SEC-ERR-01: cho phép thu ngân sinh mã qua RLS
set search_path = public
as $$
declare
  seq_num integer;
  code text;
begin
  perform pg_advisory_xact_lock(hashtext(prefix || to_char(p_date, 'YYMMDD')));
  insert into public.settings (key, value)
  values (prefix || '_seq', jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'), 'sequence', 1))
  on conflict (key) do update set value = jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'sequence', case
      when public.settings.value->>'date' = to_char(p_date, 'YYYY-MM-DD')
      then (public.settings.value->>'sequence')::integer + 1
      else 1
    end
  ) returning (value->>'sequence')::integer into seq_num;

  code := prefix || '-' || to_char(p_date, 'YYMMDD') || '-' || lpad(seq_num::text, 4, '0');
  return code;
end;
$$;

-- Hàm sinh mã master data: SP000001 (NEW-CONF-05)
create or replace function public.generate_master_code(p_prefix text default 'SP', p_length int default 6)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seq_num integer;
begin
  insert into public.settings (key, value)
  values (p_prefix || '_master_seq', jsonb_build_object('sequence', 1))
  on conflict (key) do update
  set value = jsonb_build_object('sequence', (public.settings.value->>'sequence')::integer + 1)
  returning (value->>'sequence')::integer into seq_num;

  return p_prefix || lpad(seq_num::text, p_length, '0');
end;
$$;
