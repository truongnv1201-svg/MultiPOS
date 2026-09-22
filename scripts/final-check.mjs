// Kiểm tra tổng quát DB sau P6: RLS, least-privilege anon, dữ liệu sạch, tồn không âm.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Thieu SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
let pass = 0;
let fail = 0;
function assert(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    console.log(`FAIL: ${label} ${extra}`);
  }
}
async function q(query) {
  const res = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query }),
  });
  return JSON.parse(await res.text());
}

const rls = await q(
  `select tablename from pg_tables where schemaname='public' and rowsecurity = true order by 1`
);
const rlsNames = rls.map((r) => r.tablename);
assert('RLS bật trên bảng lõi', ['products', 'orders', 'customers', 'shifts'].every((t) => rlsNames.includes(t)), rlsNames.join(','));

const anonPol = await q(
  `select tablename, cmd from pg_policies where schemaname='public' and roles::text like '%anon%' order by 1`
);
const anonWrite = anonPol.filter((p) => p.cmd !== 'SELECT');
assert('anon chỉ SELECT (không ghi)', anonWrite.length === 0, JSON.stringify(anonWrite));

const junk = await q(
  `select count(*) as c from public.orders where note ilike '%verify%' or customer_name ilike '%verify%' or customer_name = 'Smoke Test'`
);
assert('không còn đơn verify/smoke', junk[0].c === '0' || junk[0].c === 0, JSON.stringify(junk));

const neg = await q(
  `select sku from public.products where stock_quantity < 0`
);
assert('tồn kho không âm', neg.length === 0, JSON.stringify(neg));

const counts = await q(
  `select (select count(*) from public.products) as products, (select count(*) from public.profiles) as profiles, (select count(*) from public.orders) as orders, (select count(*) from public.cashbook_entries) as cashbook`
);
console.log('   counts:', JSON.stringify(counts[0]));
assert('seed đủ 11 SKU + 2 profiles', Number(counts[0].products) === 11 && Number(counts[0].profiles) === 2, JSON.stringify(counts[0]));

const funcs = await q(
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('pos_checkout','checkout_order','generate_order_code','generate_master_code','collect_debt','return_order_items','cancel_order') order by 1`
);
assert('đủ 7 RPC lõi', funcs.length === 7, JSON.stringify(funcs));

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
