import { readFileSync } from 'node:fs';

// Verify 0024 bằng ANON key (đúng quyền app POS, các RPC yêu cầu authenticated):
// Dùng login nhân viên seed (scripts/seed-users.mjs) nếu có, ngược lại chỉ test phần không cần login.
// A) debt -> collect clamp: nợ 2 chai keo 124000, thu 200000 -> collected=124000, debt=0
// B) cancel đơn cash: hoàn kho + phiếu chi PC + status cancelled
// C) return full đơn transfer vô chủ: cash_refund đủ, status returned (kho KHÔNG hoàn — parity local)
// Yêu cầu: đã apply 0024_cancel_reverse.sql.
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

// Login: lấy token authenticated (RPC 0024 chỉ grant authenticated).
// Mặc định dùng thu ngân seed (scripts/seed-users.mjs). Mã NV kiểu NV0001 -> nv0001@nv.local.
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
    console.log(`SKIP: login ${loginId} thất bại (${JSON.stringify(j).slice(0, 160)}) — chạy kèm user/pass seed: node scripts/verify-cancel-return-debt.mjs NV0001 <matkhau>`);
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

let r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.SP000007`, { headers: H });
const stockBefore = (await r.json())[0].stock_quantity;
const item = (qty) => ({
  sku: 'SP000007', name: 'Keo', item_type: 'goods', unit: 'chai', quantity: qty,
  unit_price: 62000, discount_amount: 0, processing_fee: 0, waste_factor: 0, dimension_details: null,
});

// KH test
const s = await rpc('sync_customer', { p_code: 'KHVERIFY24', p_name: 'Verify 24', p_phone: '0902424242', p_group: 'retail' });
assert('sync KH test', s.ok && s.json?.id, s.text);
const custId = s.json?.id;

// A) đơn nợ 2 chai = 124000
const debt = await rpc('pos_checkout', {
  p_customer_name: 'Verify 24', p_items: [item(2)], p_discount: 0, p_payments: [],
  p_note: 'verify24-debt', p_shipping_fee: 0, p_is_deposit: false, p_customer_id: custId,
});
assert('tạo đơn nợ 124000', debt.ok && Number(debt.json?.debt_amount) === 124000, debt.text);
const debtOrderId = debt.json?.order_id;

// A2) thu lố 200000 -> clamp đúng 124000
const col = await rpc('collect_debt', { p_customer_id: custId, p_amount: 200000, p_method: 'cash', p_note: 'verify24-collect' });
assert('thu nợ clamp 124000', col.ok && Number(col.json?.collected) === 124000, col.text);

// B) đơn cash 1 chai rồi hủy: hoàn kho + PC + cancelled
const paid = await rpc('pos_checkout', {
  p_customer_name: 'Verify 24', p_items: [item(1)], p_discount: 0,
  p_payments: [{ method: 'cash', amount: 62000 }], p_note: 'verify24-cancel',
  p_shipping_fee: 0, p_is_deposit: false,
});
assert('tạo đơn cash 62000', paid.ok, paid.text);
const cancelId = paid.json?.order_id;
const cancel = await rpc('cancel_order', { p_order_id: cancelId });
assert('hủy đơn ok', cancel.ok, cancel.text);

// C) đơn transfer 1 chai rồi trả full vô chủ
const paid2 = await rpc('pos_checkout', {
  p_customer_name: 'Verify 24', p_items: [item(1)], p_discount: 0,
  p_payments: [{ method: 'transfer', amount: 62000 }], p_note: 'verify24-return',
  p_shipping_fee: 0, p_is_deposit: false,
});
const ret = await rpc('return_order_items', { p_order_id: paid2.json?.order_id, p_refund: 62000 });
assert('trả full: cash_refund=62000', ret.ok && Number(ret.json?.cash_refund) === 62000, ret.text);
assert('trả full: debt_cut=0', ret.ok && Number(ret.json?.debt_cut) === 0, ret.text);

if (mgmt) {
  const st = await dbq(`select status from public.orders where id in ('${debtOrderId}','${cancelId}','${paid2.json?.order_id}') order by 1`);
  assert('status: cancelled + returned', st.includes('cancelled') && st.includes('returned'), st.slice(0, 160));
  const pc = await dbq(`select count(*) from public.cashbook_entries where type='expense' and reference_order_code in (select order_code from public.orders where note like 'verify24-%')`);
  assert('có phiếu chi hoàn (hủy + trả)', !pc.includes('0'), pc.slice(0, 80));
  const mv = await dbq(`select count(*) from public.stock_movements where note like 'Hoàn kho hủy đơn%' and reference_code in (select order_code from public.orders where note='verify24-cancel')`);
  assert('có bút toán hoàn kho hủy', !mv.includes('0'), mv.slice(0, 80));
  // cleanup: xóa quỹ -> đơn -> KH, trả tồn keo
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where note like 'verify24-%' or customer_id='${custId}')`);
  await dbq(`delete from public.orders where note like 'verify24-%' or customer_id='${custId}'`);
  await dbq(`update public.products set stock_quantity = ${stockBefore} where sku='SP000007'`);
  await dbq(`delete from public.stock_movements where note like 'Hoàn kho hủy đơn%' and reference_code not in (select order_code from public.orders)`);
  await dbq(`delete from public.customers where id='${custId}'`);
  const left = await dbq(`select count(*) from public.orders where note like 'verify24-%'`);
  assert('cleanup sạch đơn verify', left.includes('0'), left.slice(0, 80));
  r = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.SP000007`, { headers: H });
  const stockAfter = (await r.json())[0].stock_quantity;
  assert('tồn keo phục hồi', Number(stockAfter) === Number(stockBefore), `${stockBefore} -> ${stockAfter}`);
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}

console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
