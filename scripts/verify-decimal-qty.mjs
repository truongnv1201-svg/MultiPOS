import { readFileSync } from 'node:fs';
import { fetchCatalog, goodsItem, pickGoods } from './verify-catalog.mjs';

// Verify số lượng thập phân (2,15 kg) bằng ANON key — đúng quyền của app POS:
// 1) catalog_public có cột allow_decimal (0054), 2) bật cờ cho 1 mặt hàng,
// 3) pos_checkout lưu đúng 2.150 và trừ kho 2.150, rồi cleanup.
// Chạy: SUPABASE_ACCESS_TOKEN=sbp_... npm run test:live:decimal
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
const MGMT_URL = process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query';

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

const token = process.env.SUPABASE_ACCESS_TOKEN;
async function dbq(query) {
  const res = await fetch(MGMT_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.text();
}

if (!token) {
  console.error('Thiếu SUPABASE_ACCESS_TOKEN (cần để bật cờ + cleanup trên server).');
  process.exit(1);
}

// 1) view catalog_public (đúng nguồn POS anon đọc) phải có cột allow_decimal
const catalog = await fetchCatalog(URL, H);
assert('anon đọc catalog', Array.isArray(catalog) && catalog.length > 0);
let viewRow = await fetch(`${URL}/rest/v1/catalog_public?select=sku,allow_decimal&order=sku&limit=1`, { headers: H });
const viewRows = await viewRow.json();
assert('0054: catalog_public có cột allow_decimal', viewRow.ok && 'allow_decimal' in (viewRows[0] || {}), JSON.stringify(viewRows).slice(0, 160));
let costLeak = await fetch(`${URL}/rest/v1/catalog_public?select=avg_cost&limit=1`, { headers: H });
assert('0054: view không lộ giá vốn', !costLeak.ok, `HTTP ${costLeak.status}`);

const goods = pickGoods(catalog);
const price = Number(goods.retail_price);
const QTY = 2.15;
const total = Math.round(price * QTY);
const stockBefore = Number(goods.stock_quantity);
const note = 'verify-decimal-qty';

// 2) bật cờ cho mặt hàng này (ghi nhớ trạng thái cũ để cleanup khôi phục đúng)
let r = await fetch(`${URL}/rest/v1/products?select=sku,allow_decimal,unit,product_type&sku=eq.${goods.sku}`, { headers: H });
const flagRow = (await r.json())[0];
const allowDecimalBefore = flagRow?.allow_decimal !== false;
assert('đọc được cờ allow_decimal trên server', 'allow_decimal' in (flagRow || {}), JSON.stringify(flagRow));
await dbq(`update public.products set allow_decimal = true where sku = '${goods.sku}'`);

// 3) checkout 2.15 kg
r = await fetch(`${URL}/rest/v1/rpc/pos_checkout`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_customer_name: 'Verify Decimal',
    p_items: [goodsItem(goods, QTY)],
    p_discount: 0,
    p_payments: [{ method: 'cash', amount: total }],
    p_note: note,
    p_shipping_fee: 0,
    p_is_deposit: false,
  }),
});
const res = await r.json();
assert('pos_checkout chấp nhận số lượng 2.15', r.ok && !!res.order_id, JSON.stringify(res).slice(0, 300));
assert('tổng tiền = giá × 2.15 (làm tròn tiền)', Number(res?.total_amount) === total, `${res?.total_amount} != ${total}`);

// 4) đọc lại dòng hàng + tồn kho
r = await fetch(`${URL}/rest/v1/order_items?select=quantity,unit_price,subtotal&order_id=eq.${res.order_id}`, { headers: H });
const line = (await r.json())[0];
assert('order_items lưu đúng 2.150', Number(line?.quantity) === QTY, JSON.stringify(line));
assert('thành tiền dòng đúng', Number(line?.subtotal) === total, JSON.stringify(line));

r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: H });
const after = await r.json();
assert('trừ kho đúng 2.150 (không làm tròn về số nguyên)', Number(after[0]?.stock_quantity) === Number((stockBefore - QTY).toFixed(3)), `${after[0]?.stock_quantity} vs ${(stockBefore - QTY).toFixed(3)}`);

// cleanup: xoá đơn, khôi phục tồn + cờ
await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note = '${note}')`);
await dbq(`delete from public.orders where note = '${note}'`);
await dbq(`update public.products set stock_quantity = ${stockBefore}, allow_decimal = ${allowDecimalBefore} where sku = '${goods.sku}'`);
const chk = await dbq(`select count(*) from public.orders where note = '${note}'`);
assert('cleanup sạch đơn verify', chk.includes('0'), chk.slice(0, 120));
const chk2 = await dbq(`select stock_quantity, allow_decimal from public.products where sku = '${goods.sku}'`);
console.log(`   (đã khôi phục ${goods.sku}:`, chk2.trim().replace(/\s+/g, ' ').slice(0, 120) + ')');

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
