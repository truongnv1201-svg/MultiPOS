import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Apply 1 migration qua Management API (khi apply-migrations.mjs full bộ bị kẹt ở file lịch sử).
// Chạy: SUPABASE_ACCESS_TOKEN=sbp_... [SUPABASE_PROJECT_REF=xxx] node scripts/apply-one.mjs 0024_cancel_reverse.sql
// REF ưu tiên từ env, fallback project hiện tại; hoặc tự suy từ NEXT_PUBLIC_SUPABASE_URL trong .env.local.
function resolveRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    const m = raw.match(/NEXT_PUBLIC_SUPABASE_URL="https:\/\/([a-z0-9]+)\.supabase\.co"/);
    if (m) return m[1];
  } catch { /* fallback */ }
  return 'qrrryywrqkhggbenitsm';
}
const REF = resolveRef();
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Thieu SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}
const file = process.argv[2];
const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (res.ok) console.log(`OK: ${file}`);
else {
  console.log(`FAIL: ${file} HTTP ${res.status} ${text.slice(0, 500)}`);
  process.exit(1);
}
