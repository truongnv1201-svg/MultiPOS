import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Verify 0029 idempotency checkout (anon được gọi pos_checkout):
// 1) Checkout 1 keo kèm p_client_uuid mới -> ok, duplicate falsy.
// 2) Gọi lại Y HỆT (cùng uuid) -> duplicate:true, cùng order_id/order_code.
// 3) Tồn keo chỉ trừ 1 (không tạo đơn trùng, không trừ kho lần 2).
// 4) Cleanup đơn verify + phục hồi tồn (cần SUPABASE_ACCESS_TOKEN).
// Yêu cầu: đã apply 0029_checkout_idempotent.sql.
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
const H = { apikey: ANON, 'Content-Type': 'application/json' };
async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* raw */ }
  return { ok: r.ok, status: r.status, json: j, text: t.slice(0, 300) };
}
async function stock(sku) {
  const r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${sku}`, { headers: H });
  return Number((await r.json())[0].stock_quantity);
}

const keoBefore = await stock('SP000007');
const uuid = randomUUID();
const args = {
  p_customer_name: 'Verify 29', p_items: [{
    sku: 'SP000007', name: 'Keo', item_type: 'goods', unit: 'chai', quantity: 1,
    unit_price: 62000, discount_amount: 0, processing_fee: 0, waste_factor: 0, dimension_details: null,
  }],
  p_discount: 0, p_payments: [{ method: 'transfer', amount: 62000 }], p_note: 'verify29-idem',
  p_shipping_fee: 0, p_is_deposit: false, p_vat_percent: 0, p_client_uuid: uuid,
};
const first = await rpc('pos_checkout', args);
assert('lần 1 ok', first.ok && first.json?.order_id, first.text);
assert('lần 1 không duplicate', first.ok && !first.json?.duplicate, first.text);

const second = await rpc('pos_checkout', args);
assert('lần 2 duplicate:true', second.ok && second.json?.duplicate === true, second.text);
assert('cùng order_id', second.ok && second.json?.order_id === first.json?.order_id, second.text);
assert('cùng order_code', second.ok && second.json?.order_code === first.json?.order_code, second.text);
assert('tồn chỉ trừ 1', (await stock('SP000007')) === keoBefore - 1, `truoc ${keoBefore}`);

if (mgmt) {
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify29-%')`);
  await dbq(`delete from public.orders where note like 'verify29-%'`);
  await dbq(`update public.products set stock_quantity = ${keoBefore} where sku='SP000007'`);
  const left = await dbq(`select count(*) from public.orders where note like 'verify29-%'`);
  assert('cleanup sạch đơn verify', left.includes('0'), left.slice(0, 80));
  assert('tồn keo phục hồi', (await stock('SP000007')) === keoBefore, '');
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
