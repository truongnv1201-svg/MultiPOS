// Fuzz khóa parity công thức tiền local (lib/pricing.ts) vs server (pos_checkout 0023).
// Mỗi case random: hàng goods/area + CK dòng + CK bill + ship + VAT + method + tendered.
// Local tính bằng chính pricing.ts, server tính lại độc lập -> assert từng đồng
// (subtotal, vat, rounding, total, paid, debt, change).
// Cần SUPABASE_ACCESS_TOKEN (ghi đơn test + cleanup). Thiếu -> SKIP exit 0.
// Chạy: node scripts/verify-pricing-parity.mjs [n_cases]
import { readFileSync } from 'node:fs';
import {
  calculateDimensionRow,
  recomputeOrderItem,
  calcCartTotals,
  resolvePaidAmount,
} from '../lib/pricing.ts';

function loadEnv() {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)="([^"]*)"/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch { /* không có env -> skip bên dưới */ }
}
loadEnv();

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.log('SKIP: cần SUPABASE_ACCESS_TOKEN để ghi + dọn đơn fuzz');
  process.exit(0);
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' };
const mgmt = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

// PRNG có seed để fail tái hiện được
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260921);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;

async function dbq(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/qrrryywrqkhggbenitsm/database/query', {
    method: 'POST', headers: mgmt, body: JSON.stringify({ query }),
  });
  return res.text();
}
async function rpc(fn, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* raw */ }
  return { ok: r.ok, status: r.status, json: j, text: t.slice(0, 300) };
}
async function stock(sku) {
  const r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${sku}`, { headers: H });
  return Number((await r.json())[0].stock_quantity);
}

let pass = 0;
let fail = 0;
function assert(label, cond, extra = '') {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${label} ${extra}`); }
}

// Mệnh giá làm tròn thật trên server (local phải dùng cùng số mới so được)
let denom = 500;
try {
  const r = await fetch(`${URL}/rest/v1/settings?select=value&key=eq.cash_rounding`, { headers: H });
  const j = await r.json();
  if (r.ok && j?.[0]?.value?.denominator) denom = Number(j[0].value.denominator);
} catch { /* giữ 500 */ }
console.log(`denom=${denom}`);

const keoBefore = await stock('SP000007');
const kinhBefore = await stock('SP000001');
// Tạm bơm tồn để fuzz nhiều case không cạn kho giữa chừng (cuối cùng restore đúng snapshot)
await dbq(`update public.products set stock_quantity = stock_quantity + 1000 where sku='SP000007'`);
await dbq(`update public.products set stock_quantity = stock_quantity + 5000 where sku='SP000001'`);

// KH test cho case nợ
const s = await rpc('sync_customer', { p_code: 'KHPARITY', p_name: 'Parity', p_phone: '0902600000', p_group: 'retail' });
const custId = s.json?.id || null;
assert('có KH test cho case nợ', !!custId, s.text);

const N = Number(process.argv[2]) || 25;
for (let i = 0; i < N; i++) {
  // --- dựng giỏ random ---
  const nItems = rint(1, 3);
  const items = [];
  for (let k = 0; k < nItems; k++) {
    if (pick(['goods', 'goods', 'area']) === 'area') {
      const len = rint(10, 30) / 10, wid = rint(10, 30) / 10, qty = rint(1, 3);
      const grind = rint(10000, 30000);
      const dim = calculateDimensionRow({
        id: `d${i}-${k}`, length: len, width: wid, quantity: qty, grinding_type: 'xiet_bong',
        grinding_unit_price: grind, holes: 0, hole_unit_price: 25000, corners: 0,
        corner_unit_price: 15000, extra_fee: pick([0, 0, 15000]),
      });
      // Giá lẻ cố ý để phủ nhánh làm tròn dòng (0027 bắt integer 2 phía)
      const price = pick([290000, 320000, 380000, 99999, 123456]);
      items.push(recomputeOrderItem({
        id: `item-${i}-${k}`, product_id: 'area-1', sku: 'SP000001', name: 'Kính',
        product_type: 'area', unit: 'm²', unit_price: price, quantity: 0,
        discount_amount: pick([0, 0, 50000]), processing_fee: 0, subtotal: 0,
        dimension_details: [dim], waste_factor: 5,
      }));
    } else {
      const qty = rint(1, 5);
      items.push(recomputeOrderItem({
        id: `item-${i}-${k}`, product_id: 'goods-1', sku: 'SP000007', name: 'Keo',
        product_type: 'goods', unit: 'chai', unit_price: pick([62000, 61999, 57500]), quantity: qty,
        discount_amount: pick([0, 0, 10000]), processing_fee: 0, subtotal: 0,
      }));
    }
  }
  const method = pick(['cash', 'transfer', 'transfer', 'debt']);
  const cartInput = {
    items,
    discount_amount: pick([0, 0, 0, 20000, 50000]),
    discount_percent: 0,
    shipping_fee: pick([0, 0, 15000, 30000]),
    shipping_type: 'vnd',
    shipping_percent: 0,
    vat_percent: pick([0, 8, 8, 10]),
    payment_method: method,
    tendered_amount: 0,
  };
  const t0 = calcCartTotals(cartInput, denom);
  // tendered: đủ / dư / thiếu (cash luôn nhập; transfer/debt để logic quyết)
  if (method === 'cash') cartInput.tendered_amount = pick([t0.payable, t0.payable + 50000, Math.max(0, t0.payable - 30000)]);
  else if (method !== 'debt') cartInput.tendered_amount = pick([0, t0.payable, t0.payable + 100000]);
  const t = calcCartTotals(cartInput, denom);
  const paid = resolvePaidAmount(t.payable, method, cartInput.tendered_amount);
  // Gửi TIỀN KHÁCH ĐƯA y hệt client mới (không kẹp ở payable) để server chia paid/change/debt
  let tendered = cartInput.tendered_amount;
  if (method !== 'cash' && method !== 'debt' && !(tendered > 0)) tendered = t.payable;

  // --- gửi server y hệt client (ship đã gộp %, VAT riêng) ---
  const p_items = items.map((it) => ({
    sku: it.sku, name: it.name, item_type: it.product_type, unit: it.unit,
    quantity: it.quantity, unit_price: it.unit_price, discount_amount: it.discount_amount || 0,
    processing_fee: it.product_type === 'area' ? 0 : it.processing_fee || 0,
    waste_factor: it.waste_factor || 0, dimension_details: it.dimension_details || null,
  }));
  const res = await rpc('pos_checkout', {
    p_customer_name: 'Parity', p_items, p_discount: t.discount_amount,
    p_payments: method === 'debt' || !(tendered > 0) ? [] : [{ method, amount: tendered }],
    p_note: `parity-${i}`, p_shipping_fee: t.shipping_fee, p_is_deposit: false,
    p_customer_id: custId, p_vat_percent: cartInput.vat_percent,
  });
  const tag = `case ${i} (${method}, vat ${cartInput.vat_percent}%, ship ${t.shipping_fee}, CK ${t.discount_amount})`;
  if (!res.ok) {
    assert(`${tag}: RPC ok`, false, `HTTP ${res.status} ${res.text}`);
    continue;
  }
  const g = res.json;
  // 0027: server subtotal = thuần tiền hàng (đã bỏ ship ra khỏi cột này)
  assert(`${tag}: subtotal`, Number(g.subtotal) === t.subtotal, `srv ${g.subtotal} vs local ${t.subtotal}`);
  assert(`${tag}: vat`, Number(g.vat_amount) === t.vat_amount, `srv ${g.vat_amount} vs local ${t.vat_amount}`);
  assert(`${tag}: rounding`, Number(g.cash_rounding) === t.cash_rounding, `srv ${g.cash_rounding} vs local ${t.cash_rounding}`);
  assert(`${tag}: total`, Number(g.total_amount) === t.payable, `srv ${g.total_amount} vs local ${t.payable}`);
  assert(`${tag}: paid`, Number(g.paid_amount) === paid, `srv ${g.paid_amount} vs local ${paid}`);
  assert(`${tag}: debt`, Number(g.debt_amount) === t.payable - paid, `srv ${g.debt_amount} vs local ${t.payable - paid}`);
  assert(`${tag}: change`, Number(g.change_amount) === t.change_amount, `srv ${g.change_amount} vs local ${t.change_amount}`);
}

// cleanup
await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'parity-%' or customer_id='${custId}')`);
await dbq(`delete from public.orders where note like 'parity-%' or customer_id='${custId}'`);
await dbq(`update public.products set stock_quantity = ${keoBefore} where sku='SP000007'`);
await dbq(`update public.products set stock_quantity = ${kinhBefore} where sku='SP000001'`);
if (custId) await dbq(`delete from public.customers where id='${custId}'`);
const left = await dbq(`select count(*) from public.orders where note like 'parity-%'`);
assert('cleanup sạch', left.includes('0'), left.slice(0, 80));

console.log(`\nKết quả parity: ${pass} PASS / ${fail} FAIL (${N} cases)`);
process.exit(fail ? 1 : 0);
