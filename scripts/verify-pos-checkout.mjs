import { readFileSync } from 'node:fs';
import { areaItem, fetchCatalog, goodsItem, pickArea, pickGoods } from './verify-catalog.mjs';

// Verify P3 bằng ANON key (đúng quyền của app POS):
// 1) anon đọc catalog, 2) pos_checkout hàng thường + cash rounding, 3) pos_checkout hàng m² + phí mài, rồi cleanup.
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
  // Dọn dẹp bằng Management API (cần SUPABASE_ACCESS_TOKEN trong env)
  const res = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
    method: 'POST',
    headers: mgmt,
    body: JSON.stringify({ query }),
  });
  return res.text();
}

// 1) anon catalog
let r;
const catalog = await fetchCatalog(URL, H);
assert('anon đọc catalog', Array.isArray(catalog) && catalog.length > 0, JSON.stringify(catalog).slice(0, 120));
const goods = pickGoods(catalog);
const area = pickArea(catalog);
const goodsTotal = Number(goods.retail_price) * 4;
const areaData = areaItem(area, { length: 1.5, width: 2, quantity: 2 });
const areaTotal = Number(area.retail_price) * 6;

// 2) goods + cash: 4 chai keo 62k = 248000 (tròn 500, dư 250000 -> thối 2000)
const stockBefore = Number(goods.stock_quantity);
const areaStockBefore = Number(area.stock_quantity);
r = await fetch(`${URL}/rest/v1/rpc/pos_checkout`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_customer_name: 'Verify P3',
    p_items: [
      goodsItem(goods, 4),
    ],
    p_discount: 0,
    p_payments: [{ method: 'cash', amount: goodsTotal + 2000 }],
    p_note: 'verify-p3-goods',
    p_shipping_fee: 0,
    p_is_deposit: false,
  }),
});
const g = await r.json();
assert('goods cash change=2000', r.ok && Number(g.change_amount) === 2000, JSON.stringify(g).slice(0, 300));
assert('goods total theo gia catalog', Number(g.total_amount) === goodsTotal, JSON.stringify(g).slice(0, 200));

r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: H });
const after = await r.json();
assert('trừ kho 4 sản phẩm', Number(after[0].stock_quantity) === stockBefore - 4, JSON.stringify(after));

// 3) area: 1.5x2.0 x2 tấm mài xiết 20k/md -> m2=6, md=14, phí=280000; 6*380000+280000=2560000, transfer đủ
r = await fetch(`${URL}/rest/v1/rpc/pos_checkout`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_customer_name: 'Verify P3',
    p_items: [
      areaData,
    ],
    p_discount: 0,
    p_payments: [{ method: 'transfer', amount: areaTotal }],
    p_note: 'verify-p3-area',
    p_shipping_fee: 0,
    p_is_deposit: false,
  }),
});
const a = await r.json();
assert('area subtotal theo gia catalog', r.ok && Number(a.subtotal) === areaTotal, JSON.stringify(a).slice(0, 300));
assert('area transfer không làm tròn', Number(a.cash_rounding) === 0);

// cleanup (cần token quản trị)
if (mgmt) {
  await dbq(`delete from public.cashbook_entries where note in ('verify-p3-goods','verify-p3-area') or reference_order_code in (select order_code from public.orders where note like 'verify-p3-%')`);
  await dbq(`delete from public.orders where note like 'verify-p3-%'`);
  await dbq(`update public.products set stock_quantity = ${stockBefore} where sku = '${goods.sku}'`);
  await dbq(`update public.products set stock_quantity = ${areaStockBefore} where sku = '${area.sku}'`);
  const chk = await dbq(`select count(*) from public.orders where note like 'verify-p3-%'`);
  assert('cleanup sạch đơn verify', chk.includes('0'), chk.slice(0, 100));
  const chk2 = await dbq(`select stock_quantity from public.products where sku='${area.sku}'`);
  console.log(`   (tồn ${area.sku} hiện tại:`, chk2.trim() + ')');
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
