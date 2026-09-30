// Verify RPC delete_project (migration 0066) — xoá dự án tạo nhầm.
// Chạy: node scripts/verify-delete-project.mjs  (cần SUPABASE_ACCESS_TOKEN để cleanup)
//
// Vì sao cần verify: xoá dự án là thao tác PHÁ HUỶ đụng 4 bảng (projects,
// project_materials, project_workers, products) + giữ 2 bảng (stock_adjustments,
// cashbook). Ba điều phải chứng minh bằng dữ liệu thật:
//   1) Vật tư ĐÃ XUẤT được hoàn kho đúng số + có thẻ kho đảo (movement_type='return').
//   2) Dòng hao hụt KHÔNG hoàn kho (chưa từng trừ), audit hao hụt GIỮ LẠI (project_id NULL).
//   3) Các chặn: thu ngân (không is_manager) bị từ chối, anon bị chặn, xoá 2 lần báo lỗi.
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

const admin = await signIn('admin@multipos.local', 'Admin@123');
if (!admin) {
  console.log('SKIP: login admin thất bại (thiếu seed users)');
  process.exit(2);
}

// 0) Dựng dự án thử + vật tư: tạo header, xuất 2 đơn vị, ghi 1 hao hụt gắn dự án
const CODE = 'CT-VERIFY-DEL-' + Date.now().toString().slice(-6);
const created = await fetch(`${URL}/rest/v1/projects`, {
  method: 'POST',
  headers: { ...admin, Prefer: 'return=representation' },
  body: JSON.stringify({ code: CODE, name: 'Verify xoá dự án', address: 'Test' }),
});
assert('tạo dự án thử qua REST', created.ok, `HTTP ${created.status}`);
const proj = (await created.json())[0];
assert('dự án thử có id', !!proj?.id, JSON.stringify(proj).slice(0, 200));

const catRes = await fetch(
  `${URL}/rest/v1/products?select=id,sku,stock_quantity,avg_cost,product_type&product_type=eq.goods&order=sku&limit=50`,
  { headers: admin }
);
const goods = ((await catRes.json()) || []).find((p) => Number(p.stock_quantity) > 5);
if (!goods) {
  console.log('SKIP: không có hàng hóa nào đủ tồn để thử');
  process.exit(2);
}
const startStock = Number(goods.stock_quantity);
console.log(`CT ${CODE} · SKU ${goods.sku} (tồn ${startStock})`);

const issued = await rpc(admin, 'issue_project_materials', {
  p_project_id: proj.id,
  p_items: [{ sku: goods.sku, quantity: 2 }],
});
assert('xuất 2 đơn vị cho dự án thử', issued.ok, issued.text);

const adjusted = await rpc(admin, 'adjust_stock', {
  p_code: 'PQ-VERIFY-DEL',
  p_items: [{ sku: goods.sku, delta: -1, projectId: proj.id, reason: 'damage', note: 'verify xoá dự án' }],
});
assert('ghi 1 hao hụt gắn dự án thử', adjusted.ok, adjusted.text);
const afterIssue = Number(
  (await (await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin })).json())[0]
    .stock_quantity
);
assert('tồn sau xuất+hao hụt = ban đầu - 3', Math.abs(afterIssue - (startStock - 3)) < 0.001, `${startStock} -> ${afterIssue}`);

// 1) Xoá dự án
const del = await rpc(admin, 'delete_project', { p_project_id: proj.id });
assert('RPC xoá dự án thành công', del.ok, del.text);
// 1 dòng xuất thật + 1 dòng hao hụt (adjust_stock có projectId cũng ghi project_materials);
// chỉ dòng xuất thật được hoàn kho.
assert('trả về đúng mã + số dòng', del.json?.code === CODE && del.json?.material_lines === 2 && del.json?.restored_lines === 1, JSON.stringify(del.json));

// 2) Dự án + dòng vật tư/thợ đã mất
const goneRes = await fetch(`${URL}/rest/v1/projects?select=id&id=eq.${proj.id}`, { headers: admin });
assert('header dự án đã mất', ((await goneRes.json()) || []).length === 0);
const matsRes = await fetch(`${URL}/rest/v1/project_materials?select=id&project_id=eq.${proj.id}`, { headers: admin });
assert('dòng vật tư đã mất', ((await matsRes.json()) || []).length === 0);

// 3) Tồn kho được hoàn đúng 2 (chỉ dòng xuất thật, KHÔNG hoàn dòng hao hụt)
const afterDel = Number(
  (await (await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin })).json())[0]
    .stock_quantity
);
assert('tồn hoàn đúng 2 (không hoàn hao hụt)', Math.abs(afterDel - (startStock - 1)) < 0.001, `${afterIssue} -> ${afterDel}`);

// 4) Thẻ kho đảo movement_type='return'
const mvRes = await fetch(
  `${URL}/rest/v1/stock_movements?select=quantity,movement_type,note&reference_code=eq.${CODE}&order=created_at`,
  { headers: admin }
);
const mv = (await mvRes.json()) || [];
const reversal = mv.find((m) => Number(m.quantity) === 2 && m.movement_type === 'return');
assert('có thẻ kho đảo return +2', !!reversal, JSON.stringify(mv).slice(0, 250));

// 5) Audit hao hụt GIỮ LẠI, project_id về NULL
const adjRes = await fetch(`${URL}/rest/v1/stock_adjustments?select=id,project_id,delta&code=eq.PQ-VERIFY-DEL`, {
  headers: admin,
});
const adj = (await adjRes.json()) || [];
assert('dòng audit hao hụt còn (không bị xoá theo)', adj.length === 1, JSON.stringify(adj));
assert('project_id audit về NULL (thành hao hụt kho chung)', adj[0]?.project_id === null, JSON.stringify(adj[0]));

// 6) Các chặn
const cashier = await signIn('cashier@multipos.local', 'Cashier@123');
if (cashier) {
  // RPC chặn is_manager() TRƯỚC khi kiểm tra tồn tại, nên thu ngân luôn nhận lỗi quyền
  // (dù dự án đã bị xoá) — đúng thứ tự kiểm tra.
  const forbidden = await rpc(cashier, 'delete_project', { p_project_id: proj.id });
  assert('thu ngân bị chặn quyền (không phải is_manager)', !forbidden.ok && /Admin\/Quản lý/.test(forbidden.text), forbidden.text);
} else {
  console.log('SKIP: không login được cashier để thử chặn quyền');
}
const anon = await rpc({ apikey: ANON, 'Content-Type': 'application/json' }, 'delete_project', {
  p_project_id: proj.id,
});
assert('anon bị chặn', !anon.ok, `HTTP ${anon.status} ` + anon.text);
const again = await rpc(admin, 'delete_project', { p_project_id: proj.id });
assert('xoá lần 2 báo dự án không tồn tại', !again.ok && /không tồn tại/.test(again.text), again.text);

// 7) Cleanup: xoá thẻ kho thử + audit thử, trả tồn về ban đầu
if (mgmt) {
  await dbq(`delete from public.stock_movements where reference_code in ('${CODE}', 'PQ-VERIFY-DEL')`);
  await dbq(`delete from public.stock_adjustments where code = 'PQ-VERIFY-DEL'`);
  await dbq(`delete from public.projects where code = '${CODE}'`);
  await dbq(`update public.products set stock_quantity = ${startStock} where id = '${goods.id}'`);
  const left = await dbq(`select count(*) from public.projects where code = '${CODE}'`);
  const back = await dbq(`select stock_quantity from public.products where id = '${goods.id}'`);
  assert('cleanup sạch (không còn dự án thử)', left.includes('0'), left.slice(0, 120));
  assert('tồn kho trả về đúng ban đầu', back.includes(String(startStock)), back.slice(0, 120));
} else {
  console.log('WARN: thiếu SUPABASE_ACCESS_TOKEN -> chưa cleanup');
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
