const REF = process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Thieu SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}
async function q(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  console.log(`--- ${label} (HTTP ${res.status})`);
  console.log(text.slice(0, 2000));
}
await q('tables', `select tablename from pg_tables where schemaname='public' order by 1`);
await q('order_code', `select public.generate_order_code('HD') as hd, public.generate_master_code('SP') as sku`);
await q('rounding_default', `select value from public.settings where key='cash_rounding'`);
await q(
  'checkout_smoke',
  `with o as (insert into public.orders (order_code, customer_name, status) values (public.generate_order_code('HD'), 'Smoke Test', 'pending') returning id, order_code) select id, order_code from o`,
);
