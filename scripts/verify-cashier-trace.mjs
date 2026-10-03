// Live verify 0070: bán 1 đơn qua REST dưới tên NV0001 -> đơn ghi đúng
// cashier_id + cashier_name -> hủy đơn -> xóa cứng mọi dòng test (net-zero).
// Không cần token đặc biệt: login anon + pooler DATABASE_URL để dọn.
// Cần package pg ở máy chạy (dev) + DATABASE_URL. Thiếu -> SKIP exit 0.
import { createRequire } from 'node:module';

let pg;
try {
  pg = createRequire(import.meta.url)('pg');
} catch {
  try {
    pg = (await import('pg')).default;
  } catch {
    console.log('SKIP: cần package pg + DATABASE_URL để verify live 0070');
    process.exit(0);
  }
}
if (!process.env.DATABASE_URL) {
  console.log('SKIP: cần DATABASE_URL để verify live 0070');
  process.exit(0);
}

const URL = 'https://mhzufgiuhtdavnpgntxa.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oenVmZ2l1aHRkYXZucGdudHhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDI3OTYsImV4cCI6MjEwNjQxODc5Nn0.50DzECx-h5FH_Eko8jffNr3mpgT3BHSiFI6QwAjzXVw';
const H = { apikey: ANON, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const assert = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok: ${label}`); }
  else { fail++; console.log(`FAIL: ${label} ${extra}`); }
};

const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ email: 'nv0001@nv.local', password: '123456' }),
}).then((r) => r.json());
assert('login NV0001', !!login.access_token, login.msg || login.error_description || '');
const uid = login.user?.id;
const U = { apikey: ANON, Authorization: `Bearer ${login.access_token}`, 'Content-Type': 'application/json' };
const rpc = (fn, body) => fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: U, body: JSON.stringify(body) }).then((r) => r.json());

// Lấy 1 SP có tồn để bán 1 cái
const prods = await fetch(`${URL}/rest/v1/products?select=sku,name,retail_price,stock_quantity&order=stock_quantity.desc&limit=5`, { headers: U }).then((r) => r.json());
const prod = (Array.isArray(prods) ? prods : []).find((p) => Number(p.stock_quantity) > 0 && Number(p.retail_price) > 0);
assert('có hàng để bán thử', !!prod, JSON.stringify(prods).slice(0, 120));

let orderId = null, orderCode = null;
try {
  const total = Math.round(Number(prod.retail_price));
  const res = await rpc('pos_checkout', {
    p_customer_name: 'Khach Verify70', p_note: 'verify-0070-cashier-trace',
    p_items: [{ sku: prod.sku, name: prod.name, item_type: 'goods', unit: 'cai', quantity: 1, unit_price: total, discount_amount: 0, processing_fee: 0 }],
    p_discount: 0, p_payments: [{ method: 'cash', amount: total }], p_shipping_fee: 0,
    p_is_deposit: false, p_customer_id: null, p_vat_percent: 0, p_client_ref: `cb70-${Date.now()}`,
  });
  assert('checkout ok', !!res?.order_id, JSON.stringify(res).slice(0, 160));
  orderId = res?.order_id; orderCode = res?.order_code;

  const got = await fetch(`${URL}/rest/v1/orders?select=cashier_id,cashier_name&order_code=eq.${orderCode}`, { headers: U }).then((r) => r.json());
  const row = got?.[0] || {};
  assert('cashier_id = người bán', row.cashier_id === uid, JSON.stringify(row));
  assert('cashier_name tên thật (không "Nhân viên")', row.cashier_name === 'Nguyễn Văn Sơn', JSON.stringify(row));

  const cancel = await rpc('cancel_order', { p_order_id: orderId });
  assert('hủy để dọn', cancel?.ok === true, JSON.stringify(cancel).slice(0, 120));
} finally {
  if (orderId) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query(`delete from public.order_items where order_id=$1`, [orderId]).catch(() => {});
    await c.query(`delete from public.order_return_lines where order_id=$1`, [orderId]).catch(() => {});
    await c.query(`delete from public.cashbook_entries where reference_order_code=$1`, [orderCode]).catch(() => {});
    await c.query(`delete from public.stock_movements where reference_code=$1`, [orderCode]).catch(() => {});
    await c.query(`delete from public.orders where id=$1`, [orderId]).catch(() => {});
    await c.end();
  }
}
console.log(`\nverify-0070: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
