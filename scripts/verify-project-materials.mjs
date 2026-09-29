// Verify RPC issue_project_materials (migration 0063) — luồng xuất vật tư công trình từ POS.
// Chạy: node scripts/verify-project-materials.mjs  (cần SUPABASE_ACCESS_TOKEN để cleanup)
//
// Vì sao cần verify: trước 0063 hàm client chỉ ghi local/Dexie -> dòng vật tư MẤT sau khi
// tải lại trang (đã tái hiện trên DB thật). Test này chạy thẳng RPC có xác thực như app,
// rồi xác nhận: ghi vào project_materials, tồn kho bị trừ, có thẻ kho, rồi cleanup sạch.
import { readFileSync } from 'node:fs';

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
  const res = await fetch(
    (process.env.SUPABASE_MGMT_URL ||
      'https://api.supabase.com/v1/projects/' +
        (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') +
        '/database/query'),
    { method: 'POST', headers: mgmt, body: JSON.stringify({ query }) }
  );
  return res.text();
}
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) return null;
  return { apikey: ANON, Authorization: 'Bearer ' + j.access_token, 'Content-Type': 'application/json' };
}
async function rpc(H, fn, args) {
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

const H = await signIn('admin@multipos.local', 'Admin@123');
if (!H) {
  console.log('SKIP: login thất bại (thiếu seed users)');
  process.exit(2);
}

const projRes = await fetch(`${URL}/rest/v1/projects?select=id,code&order=code&limit=1`, { headers: H });
const proj = (await projRes.json())[0];
if (!proj) {
  console.log('SKIP: chưa có công trình nào trên DB');
  process.exit(2);
}
const catRes = await fetch(
  `${URL}/rest/v1/products?select=sku,stock_quantity,avg_cost,product_type&product_type=eq.goods&order=sku&limit=50`,
  { headers: H }
);
const goods = (await catRes.json()).find((p) => Number(p.stock_quantity) > 0);
if (!goods) {
  console.log('SKIP: không có hàng hóa nào còn tồn');
  process.exit(2);
}
console.log(`CT ${proj.code} · SKU ${goods.sku} (tồn ${goods.stock_quantity})`);

// 1) Xuất 1 đơn vị -> phải ghi vào project_materials + trừ kho + có thẻ kho
const out = await rpc(H, 'issue_project_materials', {
  p_project_id: proj.id,
  p_items: [{ sku: goods.sku, quantity: 1 }],
});
assert('RPC xuất vật tư thành công', out.ok && out.json?.inserted === 1, out.text);

const matRes = await fetch(
  `${URL}/rest/v1/project_materials?select=sku,quantity,unit_cost&project_id=eq.${proj.id}`,
  { headers: H }
);
const mats = await matRes.json();
const mine = (mats || []).filter((m) => m.sku === goods.sku);
assert('ghi 1 dòng vào project_materials', mine.length === 1, JSON.stringify(mats).slice(0, 200));
assert('số lượng đúng', Number(mine[0]?.quantity) === 1, JSON.stringify(mine[0]));
assert(
  'giá vốn lấy từ avg_cost server (không tin giá client)',
  Number(mine[0]?.unit_cost) === Math.round(Number(goods.avg_cost) * 100) / 100,
  JSON.stringify(mine[0])
);

const afterRes = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: H });
const afterStock = Number((await afterRes.json())[0].stock_quantity);
assert(
  'tồn kho bị trừ đúng 1',
  Math.abs(afterStock - (Number(goods.stock_quantity) - 1)) < 0.001,
  `${goods.stock_quantity} -> ${afterStock}`
);

const mvRes = await fetch(
  `${URL}/rest/v1/stock_movements?select=quantity,note&reference_code=eq.${proj.code}&order=id&limit=5`,
  { headers: H }
);
const mv = (await mvRes.json()) || [];
assert('có thẻ kho ghi nhận xuất', mv.length > 0 && Number(mv[0].quantity) === -1, JSON.stringify(mv[0]));

// 2) Chặn sai: tồn không đủ
const tooMuch = await rpc(H, 'issue_project_materials', {
  p_project_id: proj.id,
  p_items: [{ sku: goods.sku, quantity: Number(goods.stock_quantity) + 1000 }],
});
assert('tồn không đủ -> server từ chối', !tooMuch.ok && /tồn kho không đủ/.test(tooMuch.text), tooMuch.text);

// 3) Chặn sai: SKU không tồn tại
const badSku = await rpc(H, 'issue_project_materials', {
  p_project_id: proj.id,
  p_items: [{ sku: 'KHONG_CO_SKU_ABC', quantity: 1 }],
});
assert('SKU không có trong danh mục -> từ chối', !badSku.ok && /không tồn tại/.test(badSku.text), badSku.text);

// 4) Chặn sai: phiếu trống
const empty = await rpc(H, 'issue_project_materials', { p_project_id: proj.id, p_items: [] });
assert('phiếu trống -> từ chối', !empty.ok && /trống/.test(empty.text), empty.text);

// 5) anon không được gọi
const noAuth = { apikey: ANON, 'Content-Type': 'application/json' };
const anon = await rpc(noAuth, 'issue_project_materials', {
  p_project_id: proj.id,
  p_items: [{ sku: goods.sku, quantity: 1 }],
});
assert('anon bị chặn', !anon.ok, `HTTP ${anon.status} ` + anon.text);

if (mgmt) {
  await dbq(`delete from public.stock_movements where reference_code = '${proj.code}'`);
  await dbq(`delete from public.project_materials where project_id = '${proj.id}'`);
  await dbq(`update public.products set stock_quantity = ${Number(goods.stock_quantity)} where sku = '${goods.sku}'`);
  const left = await dbq(
    `select count(*) from public.project_materials where project_id = '${proj.id}'`
  );
  assert('cleanup sạch', left.includes('0'), left.slice(0, 120));
} else {
  console.log('WARN: thiếu SUPABASE_ACCESS_TOKEN -> chưa cleanup (còn 1 dòng vật tư thử)');
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
