import { readFileSync } from 'node:fs';

// Verify 0023 VAT riêng bằng ANON key (đúng quyền app POS):
// 1) goods + VAT 8% + cash -> VAT, rounding, total, change khớp công thức local
//    2 chai keo 62k = 124000; VAT 8% = 9920; raw = 133920; rounding = 420; total = 133500
//    cash 150000 -> change = 16500
// 2) goods + VAT 10% + ship 15000 + transfer đủ -> không làm tròn
//    62000 + 6200 + 15000 = 83200
// Yêu cầu: đã apply migration 0023_vat_support.sql. Nếu FAIL "Could not find the function"
// nghĩa là server chưa migrate.
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
const H = { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' };
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
  const res = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
    method: 'POST',
    headers: mgmt,
    body: JSON.stringify({ query }),
  });
  return res.text();
}
async function rpc(body) {
  const r = await fetch(`${URL}/rest/v1/rpc/pos_checkout`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, json: await r.json() };
}
const item = (qty) => ({
  sku: 'SP000007',
  name: 'Keo',
  item_type: 'goods',
  unit: 'chai',
  quantity: qty,
  unit_price: 62000,
  discount_amount: 0,
  processing_fee: 0,
  waste_factor: 0,
  dimension_details: null,
});

let r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.SP000007`, { headers: H });
const stockBefore = (await r.json())[0].stock_quantity;

// 1) VAT 8% + cash
const t1 = await rpc({
  p_customer_name: 'Verify VAT',
  p_items: [item(2)],
  p_discount: 0,
  p_payments: [{ method: 'cash', amount: 150000 }],
  p_note: 'verify-vat-cash8',
  p_shipping_fee: 0,
  p_is_deposit: false,
  p_vat_percent: 8,
});
assert(
  'VAT8 cash: gọi được RPC 9-arg (server đã migrate 0023)',
  t1.ok,
  `HTTP ${t1.status} ` + JSON.stringify(t1.json).slice(0, 200)
);
if (t1.ok) {
  assert('VAT8 cash: vat_amount=9920', Number(t1.json.vat_amount) === 9920, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: total=133500', Number(t1.json.total_amount) === 133500, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: rounding=420', Number(t1.json.cash_rounding) === 420, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: change=16500', Number(t1.json.change_amount) === 16500, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: debt=0', Number(t1.json.debt_amount) === 0, JSON.stringify(t1.json).slice(0, 200));
}

// 2) VAT 10% + ship + transfer
const t2 = await rpc({
  p_customer_name: 'Verify VAT',
  p_items: [item(1)],
  p_discount: 0,
  p_payments: [{ method: 'transfer', amount: 83200 }],
  p_note: 'verify-vat-ship10',
  p_shipping_fee: 15000,
  p_is_deposit: false,
  p_vat_percent: 10,
});
assert('VAT10 ship transfer: ok', t2.ok, `HTTP ${t2.status} ` + JSON.stringify(t2.json).slice(0, 200));
if (t2.ok) {
  assert('VAT10 ship transfer: vat_amount=6200', Number(t2.json.vat_amount) === 6200, JSON.stringify(t2.json).slice(0, 200));
  assert('VAT10 ship transfer: total=83200', Number(t2.json.total_amount) === 83200, JSON.stringify(t2.json).slice(0, 200));
  assert('VAT10 ship transfer: không làm tròn', Number(t2.json.cash_rounding) === 0);
  assert('VAT10 ship transfer: change=0', Number(t2.json.change_amount) === 0, JSON.stringify(t2.json).slice(0, 200));
}

// 3) VAT theo % trên (tiền hàng - CK bill): CK 24000 trên 124000 + VAT 8%
// base = 100000 -> vat = 8000; raw = 124000 + 8000 - 24000 = 108000 (transfer đủ, rounding 0)
const t3 = await rpc({
  p_customer_name: 'Verify VAT',
  p_items: [item(2)],
  p_discount: 24000,
  p_payments: [{ method: 'transfer', amount: 108000 }],
  p_note: 'verify-vat-discount',
  p_shipping_fee: 0,
  p_is_deposit: false,
  p_vat_percent: 8,
});
assert('VAT8 + CK bill: ok', t3.ok, `HTTP ${t3.status} ` + JSON.stringify(t3.json).slice(0, 200));
if (t3.ok) {
  assert('VAT8 + CK bill: vat_amount=8000', Number(t3.json.vat_amount) === 8000, JSON.stringify(t3.json).slice(0, 200));
  assert('VAT8 + CK bill: total=108000', Number(t3.json.total_amount) === 108000, JSON.stringify(t3.json).slice(0, 200));
}

if (mgmt) {
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify-vat-%')`);
  await dbq(`delete from public.orders where note like 'verify-vat-%'`);
  await dbq(`update public.products set stock_quantity = ${stockBefore} where sku = 'SP000007'`);
  const chk = await dbq(`select count(*) from public.orders where note like 'verify-vat-%'`);
  assert('cleanup sạch đơn verify', chk.includes('0'), chk.slice(0, 100));
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
