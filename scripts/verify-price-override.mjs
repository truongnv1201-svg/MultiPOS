// Verify đơn giá ghi đè ở POS (migration 0059) trên DB live, rồi cleanup sạch.
// Chạy: node scripts/verify-price-override.mjs   (cần SUPABASE_ACCESS_TOKEN trong env để cleanup)
//
// 3 case quan trọng:
//  1) THU NGÂN gửi price_override -> server phải RAISE (đây là chốt bảo mật, không được lỏ)
//  2) QUẢN LÝ gửi price_override -> order_items.unit_price = giá mới, price_override=true,
//     và tổng đơn phải chạy theo giá mới (không âm thầm rơi về giá danh mục)
//  3) QUẢN LÝ gửi price_override = đúng giá danh mục -> vẫn bán được nhưng price_override=false
import { readFileSync } from 'node:fs';
import { fetchCatalog, goodsItem, pickGoods } from './verify-catalog.mjs';

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
  const res = await fetch(
    (process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'),
    { method: 'POST', headers: mgmt, body: JSON.stringify({ query }) }
  );
  return res.text();
}
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) return null;
  return { apikey: ANON, Authorization: 'Bearer ' + j.access_token, 'Content-Type': 'application/json' };
}
async function rpc(H, fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* raw */ }
  return { ok: r.ok, status: r.status, json: j, text: t.slice(0, 300) };
}

const cashierH = await signIn('cashier@multipos.local', 'Cashier@123');
const managerH = await signIn('admin@multipos.local', 'Admin@123');
if (!cashierH || !managerH) {
  console.log('SKIP: login thất bại (thiếu seed users)');
  process.exit(2);
}
const goods = pickGoods(await fetchCatalog(URL, managerH));
const catalogPrice = Math.round(Number(goods.retail_price));
// Giá ghi đè: 60% giá danh mục, làm tròn, luôn > 0
const newPrice = Math.max(1000, Math.round((catalogPrice * 0.6) / 1000) * 1000);
console.log(`SKU ${goods.sku}: giá danh mục ${catalogPrice} -> ghi đè ${newPrice}`);

// 1) Thu ngân gửi price_override -> phải bị chặn
const asCashier = await rpc(cashierH, 'pos_checkout', {
  p_customer_name: 'Verify 59 cashier',
  p_items: [{ ...goodsItem(goods, 1), price_override: newPrice }],
  p_discount: 0, p_payments: [{ method: 'cash', amount: newPrice }], p_note: 'verify59-cashier',
  p_shipping_fee: 0, p_is_deposit: false, p_customer_id: null, p_vat_percent: 0, p_client_ref: null,
});
assert(
  'thu ngân gửi price_override bị chặn',
  !asCashier.ok && /Chỉ Quản lý\/Admin được sửa đơn giá/.test(asCashier.text),
  `HTTP ${asCashier.status} ` + asCashier.text
);

// 2) Quản lý gửi price_override -> giá mới phải được ghi thật
const asManager = await rpc(managerH, 'pos_checkout', {
  p_customer_name: 'Verify 59 manager',
  p_items: [{ ...goodsItem(goods, 1), price_override: newPrice }],
  p_discount: 0, p_payments: [{ method: 'cash', amount: newPrice }], p_note: 'verify59-manager',
  p_shipping_fee: 0, p_is_deposit: false, p_customer_id: null, p_vat_percent: 0, p_client_ref: null,
});
assert('quản lý gửi price_override tạo đơn được', asManager.ok && asManager.json?.order_id, asManager.text);
const orderId = asManager.json?.order_id;

if (orderId) {
  const row = await fetch(
    `${URL}/rest/v1/order_items?select=unit_price,price_override,price_override_by,subtotal&order_id=eq.${orderId}`,
    { headers: managerH }
  );
  const items = await row.json();
  const it = items?.[0];
  assert('order_items.unit_price = giá đã sửa', Number(it?.unit_price) === newPrice, JSON.stringify(it));
  assert('đánh dấu price_override = true', it?.price_override === true, JSON.stringify(it));
  assert('ghi ai sửa giá (price_override_by)', !!it?.price_override_by, JSON.stringify(it));
  assert('subtotal dòng = giá mới', Number(it?.subtotal) === newPrice, JSON.stringify(it));
  const order = await fetch(`${URL}/rest/v1/orders?select=total_amount&id=eq.${orderId}`, { headers: managerH });
  const o = (await order.json())?.[0];
  assert('tổng đơn chạy theo giá mới', Number(o?.total_amount) === newPrice, JSON.stringify(o));
}

// 3) Ghi đè đúng bằng giá danh mục -> bán được nhưng không để dấu vết
const samePrice = await rpc(managerH, 'pos_checkout', {
  p_customer_name: 'Verify 59 same',
  p_items: [{ ...goodsItem(goods, 1), price_override: catalogPrice }],
  p_discount: 0, p_payments: [{ method: 'cash', amount: catalogPrice }], p_note: 'verify59-same',
  p_shipping_fee: 0, p_is_deposit: false, p_customer_id: null, p_vat_percent: 0, p_client_ref: null,
});
assert('ghi đè = giá danh mục vẫn tạo đơn được', samePrice.ok && samePrice.json?.order_id, samePrice.text);
if (samePrice.json?.order_id) {
  const row = await fetch(
    `${URL}/rest/v1/order_items?select=unit_price,price_override&order_id=eq.${samePrice.json.order_id}`,
    { headers: managerH }
  );
  const it = (await row.json())?.[0];
  assert('giá = giá danh mục', Number(it?.unit_price) === catalogPrice, JSON.stringify(it));
  assert('price_override = false (không để dấu)', it?.price_override === false, JSON.stringify(it));
}

if (mgmt) {
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify59-%')`);
  await dbq(`delete from public.orders where note like 'verify59-%'`);
  const left = await dbq(`select count(*) from public.orders where note like 'verify59-%'`);
  assert('cleanup sạch', left.includes('0'), left.slice(0, 120));
} else {
  console.log('WARN: thiếu SUPABASE_ACCESS_TOKEN -> chưa cleanup, còn 2 đơn verify59-* trên DB');
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
