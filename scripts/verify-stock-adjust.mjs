// Verify RPC adjust_stock + assign_adjust_project (migration 0064) — điều chỉnh tồn / hao hụt.
// Chạy: node scripts/verify-stock-adjust.mjs  (cần SUPABASE_ACCESS_TOKEN để cleanup sạch)
//
// Vì sao cần verify: 0064 đụng vào tồn kho VÀ tiền. Ba điều phải chứng minh bằng dữ liệu
// thật chứ không chỉ bằng đọc code:
//   1) Điều chỉnh giảm tồn đúng 1 lần, ghi thẻ kho + 1 dòng audit, KHÔNG đụng avg_cost.
//   2) Gắn công trình -> ghi dòng hao hụt vào sổ vật tư công trình (P&L giảm) mà tồn
//      KHÔNG bị trừ thêm (trừ 2 lần là sai tồn, là lỗi dễ mắc nhất).
//   3) Các chặn: tồn âm, SKU lặp, thiếu lý do, hàng dịch vụ, anon, thu ngân (không phải
//      is_manager) — tất cả phải bị server từ chối.
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

const catRes = await fetch(
  `${URL}/rest/v1/products?select=id,sku,stock_quantity,avg_cost,product_type&product_type=eq.goods&order=sku&limit=50`,
  { headers: admin }
);
const goods = ((await catRes.json()) || []).find((p) => Number(p.stock_quantity) > 5);
if (!goods) {
  console.log('SKIP: không có hàng hóa nào đủ tồn để thử');
  process.exit(2);
}
const projRes = await fetch(`${URL}/rest/v1/projects?select=id,code&order=code&limit=1`, { headers: admin });
const proj = (await projRes.json())[0];
const startStock = Number(goods.stock_quantity);
const startCost = Number(goods.avg_cost);
// Mã phiếu riêng cho script: sau cả run vẫn nhận ra để dọn.
const CODE = 'PQ-VERIFY-ADJ';
console.log(`SKU ${goods.sku} (tồn ${startStock}, giá vốn ${startCost}) · CT ${proj ? proj.code : '(không có)'}`);

// 1) Dán tồn thực: chấn lệch giảm 2 đơn vị, gắn công trình
const counted = startStock - 2;
const out = await rpc(admin, 'adjust_stock', {
  p_code: CODE,
  p_items: [{ sku: goods.sku, countedStock: counted, projectId: proj ? proj.id : null, reason: 'damage', note: 'verify script' }],
});
assert('RPC điều chỉnh tồn thành công', out.ok && out.json?.adjusted === 1, out.text);

const afterRes = await fetch(`${URL}/rest/v1/products?select=stock_quantity,avg_cost&sku=eq.${goods.sku}`, { headers: admin });
const after = (await afterRes.json())[0];
assert(
  'tồn kho chấn lệch đúng (đếm thực tế)',
  Math.abs(Number(after.stock_quantity) - counted) < 0.001,
  `${startStock} -> ${after.stock_quantity}`
);
assert(
  'avg_cost KHÔNG đổi (giá vốn đã chốt lúc nhập, hao mòn không tạo giá vốn m���i)',
  Number(after.avg_cost) === startCost,
  `${startCost} -> ${after.avg_cost}`
);

const mvRes = await fetch(
  `${URL}/rest/v1/stock_movements?select=quantity,previous_stock,new_stock,movement_type,note&reference_code=eq.${CODE}`,
  { headers: admin }
);
const mv = (await mvRes.json()) || [];
assert('có 1 thẻ kho loại adjust_loss', mv.length === 1 && mv[0].movement_type === 'adjust_loss', JSON.stringify(mv[0]));
assert('thẻ kho ghi đúng tồn trước/sau', Number(mv[0]?.previous_stock) === startStock && Number(mv[0]?.new_stock) === counted, JSON.stringify(mv[0]));

const adjRes = await fetch(`${URL}/rest/v1/stock_adjustments?select=*&code=eq.${CODE}`, { headers: admin });
const adj = (await adjRes.json()) || [];
assert('có 1 dòng audit điều chỉnh', adj.length === 1, JSON.stringify(adj[0]));
assert('audit lưu lý do + người làm', adj[0]?.reason === 'damage' && !!adj[0]?.adjusted_by_name, JSON.stringify(adj[0]));
assert('audit tính giá trị hao hụt = 2 × giá vốn', Number(adj[0]?.loss_amount) === Math.round(2 * startCost * 100) / 100, JSON.stringify(adj[0]?.loss_amount));
assert('audit gắn công trình', proj ? adj[0]?.project_id === proj.id : true, JSON.stringify(adj[0]?.project_id));

// 2) Sổ vật tư công trình: dòng hao hụt có ghi, và tồn KHÔNG bị trừ thêm
if (proj) {
  const matRes = await fetch(
    `${URL}/rest/v1/project_materials?select=sku,quantity,unit_cost,is_adjust,adjust_id&project_id=eq.${proj.id}`,
    { headers: admin }
  );
  const mats = (await matRes.json()) || [];
  const waste = mats.filter((m) => m.sku === goods.sku && m.is_adjust);
  assert('ghi 1 dòng hao hụt vào sổ vật tư công trình', waste.length === 1, JSON.stringify(mats).slice(0, 200));
  assert('dòng hao hụt có số lượng = số mất', Number(waste[0]?.quantity) === 2, JSON.stringify(waste[0]));
  assert('dòng hao hụt gắn adjust_id (khóa 1-1)', !!waste[0]?.adjust_id, JSON.stringify(waste[0]?.adjust_id));
  const postMat = await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin });
  assert(
    'ghi dòng công trình KHÔNG trừ tồn lần 2 (vẫn đúng số lần trừ)',
    Math.abs(Number((await postMat.json())[0].stock_quantity) - counted) < 0.001
  );
}

// 3) Đếm thừa: đích là kho, không gắn công trình, movement_type = adjust_gain
const gain = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-GAIN',
  p_items: [{ sku: goods.sku, delta: 1, projectId: proj ? proj.id : null, reason: 'miscount' }],
});
assert('điều chỉnh tăng tồn thành công', gain.ok, gain.text);
const gainAdj = (await (await fetch(`${URL}/rest/v1/stock_adjustments?select=*&code=eq.${CODE}-GAIN`, { headers: admin })).json()) || [];
assert('đếm thừa KHÔNG gắn công trình', gainAdj[0]?.project_id === null, JSON.stringify(gainAdj[0]?.project_id));
const gainMv = (await (await fetch(`${URL}/rest/v1/stock_movements?select=movement_type&reference_code=eq.${CODE}-GAIN`, { headers: admin })).json()) || [];
assert('thẻ kho loại adjust_gain', gainMv[0]?.movement_type === 'adjust_gain', JSON.stringify(gainMv[0]));

// 4) Gán bổ sung công trình cho mục chưa gán: tồn KHÔNG đổi
if (proj) {
  const unassigned = (await (await fetch(`${URL}/rest/v1/stock_adjustments?select=*&code=eq.${CODE}-GAIN`, { headers: admin })).json()) || [];
  const stockBeforeAssign = Number((await (await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin })).json())[0].stock_quantity);
  const assign = await rpc(admin, 'assign_adjust_project', { p_adjustment_id: unassigned[0].id, p_project_id: proj.id });
  // Đếm thừa thì server cố tình từ chối gán (đích là kho) — đây là hành vi đúng.
  assert('đếm thừa không cho gán công trình', !assign.ok && /chỉ gán công trình cho khoản hao hụt/i.test(assign.text), assign.text);

  // Tạo 1 phiếu hao hụt CHƯA gán rồi gán sau -> tồn phải giữ nguyên
  const un = await rpc(admin, 'adjust_stock', {
    p_code: CODE + '-UNASSIGNED',
    p_items: [{ sku: goods.sku, delta: -1, reason: 'lost', note: 'chưa biết thuộc CT nào' }],
  });
  assert('ghi phiếu hao hụt chưa gán công trình', un.ok, un.text);
  const stockBefore = Number((await (await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin })).json())[0].stock_quantity);
  const unRow = (await (await fetch(`${URL}/rest/v1/stock_adjustments?select=*&code=eq.${CODE}-UNASSIGNED`, { headers: admin })).json()) || [];
  const assign2 = await rpc(admin, 'assign_adjust_project', { p_adjustment_id: unRow[0].id, p_project_id: proj.id });
  assert('gán bổ sung công trình thành công', assign2.ok, assign2.text);
  const stockAfter = Number((await (await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin })).json())[0].stock_quantity);
  assert('gán bổ sung KHÔNG đụng tồn kho', stockBefore === stockAfter, `${stockBefore} -> ${stockAfter}`);
  const assigned = (await (await fetch(`${URL}/rest/v1/stock_adjustments?select=project_id,project_assigned_at&code=eq.${CODE}-UNASSIGNED`, { headers: admin })).json()) || [];
  assert('audit ghi nhận đã gán + thời điểm gán', assigned[0]?.project_id === proj.id && !!assigned[0]?.project_assigned_at, JSON.stringify(assigned[0]));
  void stockBeforeAssign;
}

// 5) Các chặn sai
const neg = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-NEG',
  p_items: [{ sku: goods.sku, countedStock: -1, reason: 'damage' }],
});
assert('tồn thực tế âm -> từ chối', !neg.ok && /tồn thực tế không thể âm/.test(neg.text), neg.text);

const makeNeg = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-NEG2',
  p_items: [{ sku: goods.sku, delta: -999999, reason: 'damage' }],
});
assert('điều chỉnh làm tồn âm -> từ chối', !makeNeg.ok && /tồn âm/.test(makeNeg.text), makeNeg.text);

const dup = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-DUP',
  p_items: [
    { sku: goods.sku, delta: -1, reason: 'damage' },
    { sku: goods.sku, delta: -1, reason: 'damage' },
  ],
});
assert('SKU lặp trong 1 phiếu -> từ chối', !dup.ok && /lặp/.test(dup.text), dup.text);

const noReason = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-NOREASON',
  p_items: [{ sku: goods.sku, delta: -1, reason: '' }],
});
assert('thiếu lý do -> từ chối', !noReason.ok && /lý do/.test(noReason.text), noReason.text);

const badSku = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-BADSKU',
  p_items: [{ sku: 'KHONG_CO_SKU_ABC', delta: -1, reason: 'damage' }],
});
assert('SKU không tồn tại -> từ chối', !badSku.ok && /không tồn tại/.test(badSku.text), badSku.text);

const empty = await rpc(admin, 'adjust_stock', { p_code: CODE, p_items: [] });
assert('phiếu trống -> từ chối', !empty.ok && /trống/.test(empty.text), empty.text);

// Đọc tồn HIỆN TẠI: các bước trước đã điều chỉnh nên startStock không còn khớp.
const currentStock = Number(
  (await (await fetch(`${URL}/rest/v1/products?select=stock_quantity&sku=eq.${goods.sku}`, { headers: admin })).json())[0]
    .stock_quantity
);
const noDelta = await rpc(admin, 'adjust_stock', {
  p_code: CODE + '-NOCHANGE',
  p_items: [{ sku: goods.sku, countedStock: currentStock, reason: 'damage' }],
});
assert(
  'tồn thực tế khớp hệ thống -> từ chối (không sinh phiếu/thẻ kho rác)',
  !noDelta.ok && /không có gì để điều chỉnh/.test(noDelta.text),
  noDelta.text
);

const anon = await rpc({ apikey: ANON, 'Content-Type': 'application/json' }, 'adjust_stock', {
  p_code: CODE,
  p_items: [{ sku: goods.sku, delta: -1, reason: 'damage' }],
});
assert('anon bị chặn', !anon.ok, `HTTP ${anon.status} ` + anon.text);

const cashier = await signIn('cashier@multipos.local', 'Cashier@123');
if (cashier) {
  const forbidden = await rpc(cashier, 'adjust_stock', {
    p_code: CODE,
    p_items: [{ sku: goods.sku, delta: -1, reason: 'damage' }],
  });
  assert('thu ngân (không phải is_manager) bị chặn', !forbidden.ok && /Admin\/Quản lý/.test(forbidden.text), forbidden.text);
}

// 6) Cleanup: trả tồn về ban đầu, xoá mọi dấu vết script
if (mgmt) {
  await dbq(`delete from public.project_materials where adjust_id in (select id from public.stock_adjustments where code like '${CODE}%')`);
  await dbq(`delete from public.stock_adjustments where code like '${CODE}%'`);
  await dbq(`delete from public.stock_movements where reference_code like '${CODE}%'`);
  await dbq(`update public.products set stock_quantity = ${startStock} where id = '${goods.id}'`);
  const left = await dbq(`select count(*) from public.stock_adjustments where code like '${CODE}%'`);
  const back = await dbq(`select stock_quantity from public.products where id = '${goods.id}'`);
  assert('cleanup sạch (không còn phiếu thử)', left.includes('0'), left.slice(0, 120));
  assert('tồn kho trả về đúng ban đầu', back.includes(String(startStock)), back.slice(0, 120));
} else {
  console.log('WARN: thiếu SUPABASE_ACCESS_TOKEN -> chưa cleanup (còn phiếu điều chỉnh thử)');
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
