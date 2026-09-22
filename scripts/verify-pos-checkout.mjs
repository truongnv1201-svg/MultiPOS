import { readFileSync } from 'node:fs';

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
let r = await fetch(`${URL}/rest/v1/products?select=sku,stock_quantity&order=sku`, { headers: H });
const catalog = await r.json();
assert('anon đọc catalog 11 SKU', Array.isArray(catalog) && catalog.length === 11, JSON.stringify(catalog).slice(0, 120));

// 2) goods + cash: 4 chai keo 62k = 248000 (tròn 500, dư 250000 -> thối 2000)
const stockBefore = catalog.find((p) => p.sku === 'SP000007').stock_quantity;
r = await fetch(`${URL}/rest/v1/rpc/pos_checkout`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_customer_name: 'Verify P3',
    p_items: [
      {
        sku: 'SP000007',
        name: 'Keo',
        item_type: 'goods',
        unit: 'chai',
        quantity: 4,
        unit_price: 62000,
        discount_amount: 0,
        processing_fee: 0,
        waste_factor: 0,
        dimension_details: null,
      },
    ],
    p_discount: 0,
    p_payments: [{ method: 'cash', amount: 250000 }],
    p_note: 'verify-p3-goods',
    p_shipping_fee: 0,
    p_is_deposit: false,
  }),
});
const g = await r.json();
assert('goods cash change=2000', r.ok && Number(g.change_amount) === 2000, JSON.stringify(g).slice(0, 300));
assert('goods total=248000', Number(g.total_amount) === 248000, JSON.stringify(g).slice(0, 200));

r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.SP000007`, { headers: H });
const after = await r.json();
assert('trừ kho 4 chai', Number(after[0].stock_quantity) === Number(stockBefore) - 4, JSON.stringify(after));

// 3) area: 1.5x2.0 x2 tấm mài xiết 20k/md -> m2=6, md=14, phí=280000; 6*380000+280000=2560000, transfer đủ
r = await fetch(`${URL}/rest/v1/rpc/pos_checkout`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_customer_name: 'Verify P3',
    p_items: [
      {
        sku: 'SP000001',
        name: 'Kính 10mm',
        item_type: 'area',
        unit: 'm²',
        quantity: 6,
        unit_price: 380000,
        discount_amount: 0,
        processing_fee: 0,
        waste_factor: 5,
        dimension_details: [
          {
            length: 1.5,
            width: 2.0,
            quantity: 2,
            grinding_type: 'xiet_bong',
            grinding_unit_price: 20000,
            holes: 0,
            hole_unit_price: 25000,
            corners: 0,
            corner_unit_price: 15000,
            perimeter_md: 14,
            actual_m2: 6,
            processing_fee: 280000,
          },
        ],
      },
    ],
    p_discount: 0,
    p_payments: [{ method: 'transfer', amount: 2560000 }],
    p_note: 'verify-p3-area',
    p_shipping_fee: 0,
    p_is_deposit: false,
  }),
});
const a = await r.json();
assert('area subtotal=2560000', r.ok && Number(a.subtotal) === 2560000, JSON.stringify(a).slice(0, 300));
assert('area transfer không làm tròn', Number(a.cash_rounding) === 0);

// cleanup (cần token quản trị)
if (mgmt) {
  await dbq(`delete from public.cashbook_entries where note in ('verify-p3-goods','verify-p3-area') or reference_order_code in (select order_code from public.orders where note like 'verify-p3-%')`);
  await dbq(`delete from public.orders where note like 'verify-p3-%'`);
  await dbq(`update public.products set stock_quantity = ${stockBefore} where sku = 'SP000007'`);
  const chk = await dbq(`select count(*) from public.orders where note like 'verify-p3-%'`);
  assert('cleanup sạch đơn verify', chk.includes('0'), chk.slice(0, 100));
  const chk2 = await dbq(`select stock_quantity from public.products where sku='SP000001'`);
  console.log('   (tồn SP000001 hiện tại:', chk2.trim() + ')');
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
