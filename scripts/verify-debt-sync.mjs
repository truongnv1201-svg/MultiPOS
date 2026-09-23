import { readFileSync } from 'node:fs';

// Verify đường đọc mà nút "Đồng bộ nợ" (syncDebtsFromServer) dùng:
// batch SELECT id,current_debt,debt_limit ... .in(id, [...]) bằng authenticated.
// 1) sync KH -> nợ 62000 qua pos_checkout -> batch select thấy 62000
// 2) collect 20000 -> batch select thấy 42000 (truth sau thu)
// Yêu cầu: không cần migration mới (dùng bảng + RLS hiện có).
function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)="([^"]*)"/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
const mgmt = process.env.SUPABASE_ACCESS_TOKEN
  ? { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }
  : null;
async function dbq(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/qrrryywrqkhggbenitsm/database/query', {
    method: 'POST',
    headers: mgmt,
    body: JSON.stringify({ query }),
  });
  return res.text();
}

const loginId = process.argv[2] || 'cashier@multipos.local';
const loginPw = process.argv[3] || 'Cashier@123';
const loginEmail = loginId.includes('@') ? loginId.toLowerCase() : `${loginId.toLowerCase()}@nv.local`;
let H;
{
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: loginEmail, password: loginPw }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    console.log(`SKIP: login thất bại (${JSON.stringify(j).slice(0, 160)})`);
    process.exit(2);
  }
  H = { apikey: ANON, Authorization: 'Bearer ' + j.access_token, 'Content-Type': 'application/json' };
}
async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* raw */ }
  return { ok: r.ok, status: r.status, json: j, text: t.slice(0, 300) };
}
// Đúng query shape mà supabase-js .in() sinh ra cho syncDebtsFromServer
async function batchDebts(uuids) {
  const r = await fetch(
    `${URL}/rest/v1/customers?select=id,current_debt,debt_limit&id=in.(${uuids.join(',')})`,
    { headers: H }
  );
  return { ok: r.ok, status: r.status, json: await r.json() };
}

const s = await rpc('sync_customer', { p_code: 'KHVERIFY26', p_name: 'Verify 26', p_phone: '0902626262', p_group: 'retail' });
assert('sync KH test', s.ok && s.json?.id, s.text);
const custId = s.json?.id;

const debt = await rpc('pos_checkout', {
  p_customer_name: 'Verify 26',
  p_items: [{ sku: 'SP000007', name: 'Keo', item_type: 'goods', unit: 'chai', quantity: 1, unit_price: 62000, discount_amount: 0, processing_fee: 0, waste_factor: 0, dimension_details: null }],
  p_discount: 0, p_payments: [], p_note: 'verify26-debt', p_shipping_fee: 0, p_is_deposit: false, p_customer_id: custId,
});
assert('tạo đơn nợ 62000', debt.ok, debt.text);

const b1 = await batchDebts([custId]);
assert('batch select đọc được nợ', b1.ok && b1.json?.length === 1, `HTTP ${b1.status} ` + JSON.stringify(b1.json).slice(0, 200));
assert('truth nợ = 62000', Number(b1.json?.[0]?.current_debt) === 62000, JSON.stringify(b1.json).slice(0, 200));

const col = await rpc('collect_debt', { p_customer_id: custId, p_amount: 20000, p_method: 'cash', p_note: 'verify26-collect' });
assert('thu 20000 ok', col.ok, col.text);
const b2 = await batchDebts([custId]);
assert('truth sau thu = 42000', b2.ok && Number(b2.json?.[0]?.current_debt) === 42000, JSON.stringify(b2.json).slice(0, 200));

if (mgmt) {
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify26-%' or customer_id='${custId}')`);
  await dbq(`delete from public.orders where note like 'verify26-%' or customer_id='${custId}'`);
  await dbq(`delete from public.customers where id='${custId}'`);
  const left = await dbq(`select count(*) from public.customers where phone='0902626262'`);
  assert('cleanup sạch', left.includes('0'), left.slice(0, 80));
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
