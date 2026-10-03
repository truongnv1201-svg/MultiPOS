// Live verify 0069 trên project mới (tự dọn sạch, net-zero):
// tạo SP + KH + đơn qua pos_checkout -> trả 1 phần (status partial, kho +đúng) ->
// trả nốt (status returned) -> trả nữa bị cap 0 -> cancel bị chặn.
// Cần DATABASE_URL pooler (local). Thiếu -> SKIP exit 0 (an toàn trên CI).
import { createRequire } from 'node:module';

let pg;
try {
  // pg chỉ có ở máy dev (không phải dependency app) — thiếu thì SKIP an toàn.
  pg = createRequire(import.meta.url)('pg');
} catch {
  try {
    pg = (await import('pg')).default;
  } catch {
    console.log('SKIP: cần package pg + DATABASE_URL để verify live 0069');
    process.exit(0);
  }
}

if (!process.env.DATABASE_URL) {
  console.log('SKIP: cần DATABASE_URL để verify live 0069');
  process.exit(0);
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

let pass = 0, fail = 0;
const assert = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok: ${label}`); }
  else { fail++; console.log(`FAIL: ${label} ${extra}`); }
};

const S = `T${Date.now().toString(36)}`;
const sku = `ZZ-${S}`;
const custName = `Verify69 ${S}`;
let prodId = null, custId = null, orderId = null;
try {
  const p = await c.query(
    `insert into public.products (sku, name, product_type, unit, retail_price, import_price, avg_cost, stock_quantity, allow_decimal)
     values ($1, 'SP verify 69', 'goods', 'cai', 20000, 15000, 15000, 100, true)
     returning id`, [sku]);
  prodId = p.rows[0].id;

  const cu = await c.query(
    `insert into public.customers (code, name, phone, customer_group) values ($1, $2, $3, 'retail') returning id`,
    [`KH${S}`, custName, `09${S}`.slice(0, 10)]);
  custId = cu.rows[0].id;

  // Bán 10 cái, trả tiền đủ
  const o = await c.query(`select public.pos_checkout($1,$2,0,$3,null,0,false,$4,0,$5) r`, [
    'Khach Verify', JSON.stringify([{ sku, name: 'SP verify 69', item_type: 'goods', unit: 'cai', quantity: 10, unit_price: 20000, discount_amount: 0, processing_fee: 0 }]),
    JSON.stringify([{ method: 'cash', amount: 200000 }]), custId, `cb69-${S}`,
  ]);
  assert('checkout ok', !o.rows[0].r?.error && o.rows[0].r?.ok !== false, JSON.stringify(o.rows[0].r).slice(0, 120));
  orderId = o.rows[0].r?.order_id;
  const st0 = await c.query(`select stock_quantity from public.products where id=$1`, [prodId]);
  assert('trừ kho 10', Number(st0.rows[0].stock_quantity) === 90, st0.rows[0].stock_quantity);

  // Trả 4/10
  const r1 = await c.query(`select public.return_order_items($1, 80000, $2) r`, [
    orderId, JSON.stringify([{ sku, quantity: 4 }])]);
  assert('trả 1 phần ok', r1.rows[0].r?.ok === true, JSON.stringify(r1.rows[0].r).slice(0, 160));
  assert('status partial', r1.rows[0].r?.status === 'partial_returned', r1.rows[0].r?.status);
  const st1 = await c.query(`select stock_quantity from public.products where id=$1`, [prodId]);
  assert('hoàn kho 4', Number(st1.rows[0].stock_quantity) === 94, st1.rows[0].stock_quantity);

  // Trả 10 nữa (vượt phần còn lại 6) -> cap 6, status returned
  const r2 = await c.query(`select public.return_order_items($1, 120000, $2) r`, [
    orderId, JSON.stringify([{ sku, quantity: 10 }])]);
  const got = (r2.rows[0].r?.restocked || []).reduce((s, e) => s + Number(e.quantity), 0);
  assert('cap phần còn lại (6)', got === 6, JSON.stringify(r2.rows[0].r).slice(0, 160));
  assert('status returned', r2.rows[0].r?.status === 'returned', r2.rows[0].r?.status);
  const st2 = await c.query(`select stock_quantity from public.products where id=$1`, [prodId]);
  assert('hoàn kho tổng 10', Number(st2.rows[0].stock_quantity) === 100, st2.rows[0].stock_quantity);
  const led = await c.query(`select coalesce(sum(quantity),0) s, count(*) n from public.order_return_lines where order_id=$1`, [orderId]);
  assert('sổ 2 dòng = 10', Number(led.rows[0].s) === 10 && Number(led.rows[0].n) === 2, JSON.stringify(led.rows[0]));

  // Hủy đơn đã trả hết -> server từ chối (tránh hoàn tiền 2 lần)
  try {
    await c.query(`select public.cancel_order($1)`, [orderId]);
    assert('cancel đơn returned bị chặn', false, 'không raise');
  } catch (e) {
    assert('cancel đơn returned bị chặn', /không hợp lệ/.test(e.message), e.message.slice(0, 80));
  }
} finally {
  if (orderId) {
    await c.query(`delete from public.order_items where order_id=$1`, [orderId]).catch(() => {});
    await c.query(`delete from public.order_return_lines where order_id=$1`, [orderId]).catch(() => {});
    await c.query(`delete from public.cashbook_entries where reference_order_code like 'VERIFY69%' or reference_order_code in (select order_code from public.orders where id=$1)`, [orderId]).catch(() => {});
    await c.query(`delete from public.stock_movements where reference_code in (select order_code from public.orders where id=$1)`, [orderId]).catch(() => {});
    await c.query(`delete from public.orders where id=$1`, [orderId]).catch(() => {});
  }
  if (prodId) await c.query(`delete from public.products where id=$1`, [prodId]).catch(() => {});
  if (custId) await c.query(`delete from public.customers where id=$1`, [custId]).catch(() => {});
  await c.end();
}
console.log(`\nverify-0069: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
