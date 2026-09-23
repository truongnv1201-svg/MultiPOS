import { readFileSync } from 'node:fs';
import { areaItem, fetchCatalog, goodsItem, pickArea, pickGoods } from './verify-catalog.mjs';

// Verify 0025 trả hàng hoàn kho (authenticated — RPC chỉ grant authenticated):
// 1) Bán 3 keo + 1 tấm kính 1.5x2.0 (m2=3, md=7, mài 20k/md -> phí 140000):
//    keo 186000 + kính 1280000 = 1466000, transfer đủ.
// 2) Trả full + restock [keo x3, kính x3] -> keo hoàn 3, kính SKIPPED (area không nhập lại),
//    cash_refund=1466000, debt_cut=0, tồn keo về cũ, tồn kính giữ nguyên đã trừ.
// 3) Đơn 1 keo khác, restock khai khống x99 -> cap đúng 1.
// Yêu cầu: đã apply 0025_return_restock.sql.
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
  const res = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
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
async function stock(sku) {
  const r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${sku}`, { headers: H });
  return Number((await r.json())[0].stock_quantity);
}

const catalog = await fetchCatalog(URL, H);
const goods = pickGoods(catalog);
const area = pickArea(catalog);
const keoBefore = await stock(goods.sku);
const kinhBefore = await stock(area.sku);
const keoItem = (qty) => goodsItem(goods, qty);
const kinhItem = () => areaItem(area);
const goodsPrice = Number(goods.retail_price);
const areaPrice = Number(area.retail_price);
const saleTotal = goodsPrice * 3 + areaPrice * 3;

// 1) bán 1466000
const sale = await rpc('pos_checkout', {
  p_customer_name: 'Verify 25', p_items: [keoItem(3), kinhItem()], p_discount: 0,
  p_payments: [{ method: 'transfer', amount: saleTotal }], p_note: 'verify25-sale',
  p_shipping_fee: 0, p_is_deposit: false,
});
assert('bán theo catalog ok', sale.ok && Number(sale.json?.total_amount) === saleTotal, sale.text);
const areaAfterSale = await stock(area.sku);

// 2) trả full + restock keo 3 + kính 3 (kính phải bị skip)
const ret = await rpc('return_order_items', {
  p_order_id: sale.json?.order_id, p_refund: saleTotal,
  p_restock: [{ sku: goods.sku, quantity: 3 }, { sku: area.sku, quantity: 3 }],
});
assert('trả full ok', ret.ok, ret.text);
const rs = ret.json?.restocked || [];
const sk = ret.json?.skipped || [];
assert('hàng hoàn đúng 3', rs.some((e) => e.sku === goods.sku && Number(e.quantity) === 3), JSON.stringify(rs));
assert('area bị skip', sk.some((e) => e.sku === area.sku), JSON.stringify(sk));
assert('cash_refund đúng tổng', Number(ret.json?.cash_refund) === saleTotal, ret.text);
assert('hàng về tồn cũ', (await stock(goods.sku)) === keoBefore, `truoc ${keoBefore}`);
assert('area không nhập lại sau trả', (await stock(area.sku)) === areaAfterSale, `truoc ${areaAfterSale}`);

// 3) khai khống x99 -> cap 1
const sale2 = await rpc('pos_checkout', {
  p_customer_name: 'Verify 25', p_items: [keoItem(1)], p_discount: 0,
  p_payments: [{ method: 'transfer', amount: goodsPrice }], p_note: 'verify25-cap',
  p_shipping_fee: 0, p_is_deposit: false,
});
const ret2 = await rpc('return_order_items', {
  p_order_id: sale2.json?.order_id, p_refund: goodsPrice,
  p_restock: [{ sku: goods.sku, quantity: 99 }],
});
const rs2 = ret2.json?.restocked || [];
assert('khai khống bị cap 1', ret2.ok && rs2.some((e) => e.sku === goods.sku && Number(e.quantity) === 1), JSON.stringify(rs2));

// 4) gọi lặp trên đơn đã returned -> bị chặn, không tác dụng phụ
const stockMidKeo = await stock(goods.sku);
const ret3 = await rpc('return_order_items', {
  p_order_id: sale.json?.order_id, p_refund: saleTotal,
  p_restock: [{ sku: goods.sku, quantity: 3 }],
});
assert('trả lặp bị chặn', !ret3.ok && ret3.text.includes('đã trả'), ret3.text);
assert('trả lặp không cộng kho', (await stock(goods.sku)) === stockMidKeo, '');
const cancelAfter = await rpc('cancel_order', { p_order_id: sale.json?.order_id });
assert('hủy sau trả bị chặn', !cancelAfter.ok, cancelAfter.text);
assert('hủy sau trả không cộng kho', (await stock(goods.sku)) === stockMidKeo, '');

if (mgmt) {
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify25-%')`);
  await dbq(`delete from public.orders where note like 'verify25-%'`);
  await dbq(`update public.products set stock_quantity = ${keoBefore} where sku='${goods.sku}'`);
  await dbq(`update public.products set stock_quantity = ${kinhBefore} where sku='${area.sku}'`);
  await dbq(`delete from public.stock_movements where note like 'Nhập lại trả hàng%' and reference_code not in (select order_code from public.orders)`);
  const left = await dbq(`select count(*) from public.orders where note like 'verify25-%'`);
  assert('cleanup sạch đơn verify', left.includes('0'), left.slice(0, 80));
  assert('tồn hàng phục hồi', (await stock(goods.sku)) === keoBefore, '');
  assert('tồn area phục hồi', (await stock(area.sku)) === kinhBefore, '');
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
