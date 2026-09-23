import { readFileSync } from 'node:fs';

// Verify 0009 bằng ANON: sync idempotent, nợ có chủ OK + trừ nợ KH, nợ vô chủ bị chặn, cleanup.
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
const mgmt = process.env.SUPABASE_ACCESS_TOKEN
  ? { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }
  : null;
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
async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {
    /* raw */
  }
  return { ok: r.ok, status: r.status, json: j, text: t.slice(0, 300) };
}
async function dbq(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/qrrryywrqkhggbenitsm/database/query', {
    method: 'POST',
    headers: mgmt,
    body: JSON.stringify({ query }),
  });
  return res.text();
}

// 0) snapshot tồn trước test để restore tương đối (không bao giờ reset tuyệt đối)
const snapRes = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.SP000007`, { headers: H });
const snapKeo = (await snapRes.json())[0]?.stock_quantity;

// 1) sync idempotent theo phone
const s1 = await rpc('sync_customer', {
  p_code: 'KHTEST',
  p_name: 'Verify KH',
  p_phone: '0909999888',
  p_group: 'retail',
  p_debt_limit: 10000000,
});
assert('sync_customer tạo mới', s1.ok && s1.json?.id, s1.text);
const s2 = await rpc('sync_customer', {
  p_code: 'KHTEST',
  p_name: 'Verify KH Đổi Tên',
  p_phone: '0909999888',
  p_group: 'retail',
});
assert('sync_customer idempotent (cùng id)', s2.ok && s2.json?.id === s1.json?.id, s2.text);
const custId = s1.json?.id;

// 2) nợ vô chủ bị server chặn
const bad = await rpc('pos_checkout', {
  p_customer_name: 'Khách Lẻ',
  p_items: [
    { sku: 'SP000007', name: 'Keo', item_type: 'goods', unit: 'chai', quantity: 1, unit_price: 62000, discount_amount: 0, processing_fee: 0, waste_factor: 0, dimension_details: null },
  ],
  p_discount: 0,
  p_payments: [],
  p_is_deposit: false,
});
assert('nợ vô chủ bị chặn', !bad.ok && bad.text.includes('Bán nợ'), bad.text);

// 3) nợ có chủ: trừ nợ KH + đơn debt
const good = await rpc('pos_checkout', {
  p_customer_name: 'Verify KH',
  p_items: [
    { sku: 'SP000007', name: 'Keo', item_type: 'goods', unit: 'chai', quantity: 1, unit_price: 62000, discount_amount: 0, processing_fee: 0, waste_factor: 0, dimension_details: null },
  ],
  p_discount: 0,
  p_payments: [],
  p_is_deposit: false,
  p_customer_id: custId,
});
assert('nợ có chủ OK, debt=62000', good.ok && Number(good.json?.debt_amount) === 62000, good.text);

// 4) thanh toán đủ không cần KH (hồi quy)
const full = await rpc('pos_checkout', {
  p_customer_name: 'Khách Lẻ',
  p_items: [
    { sku: 'SP000007', name: 'Keo', item_type: 'goods', unit: 'chai', quantity: 1, unit_price: 62000, discount_amount: 0, processing_fee: 0, waste_factor: 0, dimension_details: null },
  ],
  p_discount: 0,
  p_payments: [{ method: 'cash', amount: 62000 }],
  p_is_deposit: false,
});
assert('trả đủ không cần KH', full.ok && Number(full.json?.debt_amount) === 0, full.text);

if (mgmt) {
  const chkDebt = await dbq(`select current_debt from public.customers where id = '${custId}'`);
  assert('nợ KH tăng 62000', chkDebt.includes('62000'), chkDebt.slice(0, 120));
  await dbq(`delete from public.cashbook_entries where reference_order_code in (select order_code from public.orders where customer_id = '${custId}' or note like '%Verify%')`);
  await dbq(`delete from public.orders where customer_id = '${custId}'`);
  await dbq(`delete from public.orders where note like '%Verify%'`);
  await dbq(`update public.products set stock_quantity = ${snapKeo} where sku = 'SP000007'`);
  await dbq(`delete from public.customers where id = '${custId}'`);
  const left = await dbq(`select count(*) from public.customers where phone = '0909999888'`);
  assert('cleanup sạch KH verify', left.includes('0'), left.slice(0, 80));
} else {
  console.log('SKIP cleanup (thiếu SUPABASE_ACCESS_TOKEN)');
}
console.log(`\nKết quả: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
