import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Audit ACL các hàm SECURITY DEFINER trong schema public: hàm definer bỏ qua RLS nên
// TUYỆT ĐỐI không được để PUBLIC/anon gọi được — trừ whitelist cố ý (xem bên dưới).
// Bài học 0068/0077: Postgres mặc định cấp EXECUTE cho PUBLIC; mỗi lần DROP + tạo lại
// hàm (nhất là pos_checkout) là cửa mở lại nếu quên revoke. Chạy script này sau mỗi
// lần apply migration để bắt ngay.
//
// Chạy: SUPABASE_ACCESS_TOKEN=sbp_... [SUPABASE_PROJECT_REF=xxx] node scripts/audit-rpc-acl.mjs
// (REF ưu tiên env, fallback tự suy từ NEXT_PUBLIC_SUPABASE_URL trong .env.local)

// Cố ý mở cho anon (đã ghi rõ trong migration, không phải lỗi):
// - sync_customer: tạo nhanh KH không cần đăng nhập (0009/0068)
// - is_admin/is_manager: helper đọc profiles của auth.uid() (0012 grant anon; anon -> false)
const ALLOW_ANON = new Set(['sync_customer', 'is_admin', 'is_manager']);

function resolveRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    const m = raw.match(/NEXT_PUBLIC_SUPABASE_URL="https:\/\/([a-z0-9]+)\.supabase\.co"/);
    if (m) return m[1];
  } catch { /* fallback */ }
  return 'qrrryywrqkhggbenitsm';
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Thieu SUPABASE_ACCESS_TOKEN (Personal Access Token supabase.com/dashboard/account/tokens)');
  process.exit(1);
}
const REF = resolveRef();
const MGMT_URL = process.env.SUPABASE_MGMT_URL || `https://api.supabase.com/v1/projects/${REF}/database/query`;

const QUERY = `
select
  p.proname as name,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can,
  exists (
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) as public_can,
  coalesce(p.proacl::text, '(default: PUBLIC)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true
order by p.proname;
`;

const res = await fetch(MGMT_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERY }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`FAIL HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}

let rows;
try {
  rows = JSON.parse(text);
} catch {
  console.error(`Khong parse duoc ket qua: ${text.slice(0, 300)}`);
  process.exit(1);
}

const violations = rows.filter((r) => (r.anon_can || r.public_can) && !ALLOW_ANON.has(r.name));
const allowed = rows.filter((r) => (r.anon_can || r.public_can) && ALLOW_ANON.has(r.name));

console.log(`SECURITY DEFINER trong public: ${rows.length} ham`);
if (rows.length === 0) {
  console.log('  (khong co ham definer nao — kiem tra lai quyen truy van?)');
}
for (const r of allowed) {
  console.log(`  (whitelist anon) ${r.name}(${r.args})`);
}
if (violations.length > 0) {
  console.error(`\nFAIL: ${violations.length} ham definer mo cho PUBLIC/anon ngoai whitelist:`);
  for (const r of violations) {
    console.error(`  - ${r.name}(${r.args}) | anon=${r.anon_can} public=${r.public_can}`);
    console.error(`    acl: ${r.acl}`);
  }
  console.error('\nCach sua: REVOKE EXECUTE ... FROM PUBLIC; REVOKE ... FROM anon; GRANT ... TO authenticated;');
  process.exit(1);
}
console.log('\nOK: khong co ham definer nao lo cho PUBLIC/anon ngoai whitelist.');
