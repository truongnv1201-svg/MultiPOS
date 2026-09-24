import { readFileSync } from 'node:fs';
import { fetchCatalog, goodsItem, pickGoods } from './verify-catalog.mjs';

// Verify 0023 VAT riêng bằng ANON key (đúng quyền app POS):
// 1) goods + VAT 8% + cash -> VAT, rounding, total, change khớp công thức server
//    (server làm tròn floor: total = raw - raw % denom, đọc denom từ settings;
//    VD denom 500, raw 133920 -> rounding 420 -> total 133500)
//    cash tendered = total + 16500 -> change = 16500
// 2) goods + VAT 10% + ship 15000 + transfer đủ -> không làm tròn
// 3) VAT tính trên (tiền hàng - CK bill), không gồm ship
// 2) goods + VAT 10% + ship 15000 + transfer đủ -> không làm tròn
//    total = price + price*10% + 15000 (tính từ giá catalog live)
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
const catalog = await fetchCatalog(URL, H);
const goods = pickGoods(catalog);
// P4b: đọc denom GCF làm tròn từ settings (giống server 0023/0028: floor về denom),
// thay vì hardcode 500 — script pass với mọi giá catalog.
let denom = 500;
try {
  const rs = await fetch(`${URL}/rest/v1/settings?select=value&key=eq.cash_rounding`, { headers: H });
  const js = await rs.json();
  denom = Number(js?.[0]?.value?.denominator) || 500;
} catch {
  /* giữ default 500 */
}
const floorDenom = (value) => value - (value % denom);
const price = Number(goods.retail_price);
const item = (qty) => goodsItem(goods, qty);

let r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: H });
const stockBefore = Number((await r.json())[0].stock_quantity);
const base2 = price * 2;
const vat8 = base2 * 0.08;
const total8 = floorDenom(base2 + vat8);
const total10Ship = price + price * 0.1 + 15000;
const discountedBase = base2 - 24000;
const totalDiscounted = discountedBase + discountedBase * 0.08;

// 1) VAT 8% + cash
const t1 = await rpc({
  p_customer_name: 'Verify VAT',
  p_items: [item(2)],
  p_discount: 0,
  p_payments: [{ method: 'cash', amount: total8 + 16500 }],
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
  assert('VAT8 cash: vat theo gia catalog', Number(t1.json.vat_amount) === vat8, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: total theo rounding', Number(t1.json.total_amount) === total8, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: paid_amount theo rounding', Number(t1.json.paid_amount) === total8, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: change=16500', Number(t1.json.change_amount) === 16500, JSON.stringify(t1.json).slice(0, 200));
  assert('VAT8 cash: debt=0', Number(t1.json.debt_amount) === 0, JSON.stringify(t1.json).slice(0, 200));
}

// 2) VAT 10% + ship + transfer
const t2 = await rpc({
  p_customer_name: 'Verify VAT',
  p_items: [item(1)],
  p_discount: 0,
  p_payments: [{ method: 'transfer', amount: total10Ship }],
  p_note: 'verify-vat-ship10',
  p_shipping_fee: 15000,
  p_is_deposit: false,
  p_vat_percent: 10,
});
assert('VAT10 ship transfer: ok', t2.ok, `HTTP ${t2.status} ` + JSON.stringify(t2.json).slice(0, 200));
if (t2.ok) {
  assert('VAT10 ship transfer: vat theo gia catalog', Number(t2.json.vat_amount) === price * 0.1, JSON.stringify(t2.json).slice(0, 200));
  assert('VAT10 ship transfer: total theo gia catalog', Number(t2.json.total_amount) === total10Ship, JSON.stringify(t2.json).slice(0, 200));
  assert('VAT10 ship transfer: không làm tròn', Number(t2.json.cash_rounding) === 0);
  assert('VAT10 ship transfer: change=0', Number(t2.json.change_amount) === 0, JSON.stringify(t2.json).slice(0, 200));
}

// 3) VAT theo % trên (tiền hàng - CK bill): CK 24000 trên 124000 + VAT 8%
// base = 100000 -> vat = 8000; raw = 124000 + 8000 - 24000 = 108000 (transfer đủ, rounding 0)
const t3 = await rpc({
  p_customer_name: 'Verify VAT',
  p_items: [item(2)],
  p_discount: 24000,
  p_payments: [{ method: 'transfer', amount: totalDiscounted }],
  p_note: 'verify-vat-discount',
  p_shipping_fee: 0,
  p_is_deposit: false,
  p_vat_percent: 8,
});
assert('VAT8 + CK bill: ok', t3.ok, `HTTP ${t3.status} ` + JSON.stringify(t3.json).slice(0, 200));
if (t3.ok) {
  assert('VAT8 + CK bill: vat theo gia catalog', Number(t3.json.vat_amount) === discountedBase * 0.08, JSON.stringify(t3.json).slice(0, 200));
  assert('VAT8 + CK bill: total theo gia catalog', Number(t3.json.total_amount) === totalDiscounted, JSON.stringify(t3.json).slice(0, 200));
}

if (mgmt) {
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify-vat-%')`);
  await dbq(`delete from public.orders where note like 'verify-vat-%'`);
  await dbq(`update public.products set stock_quantity = ${stockBefore} where sku = '${goods.sku}'`);
  const chk = await dbq(`select count(*) from public.orders where note like 'verify-vat-%'`);
  assert('cleanup sạch đơn verify', chk.includes('0'), chk.slice(0, 100));
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
