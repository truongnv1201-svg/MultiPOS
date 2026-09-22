import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Apply toàn bộ supabase/migrations lên project qua Management API.
// Chạy: SUPABASE_ACCESS_TOKEN=sbp_... [SUPABASE_PROJECT_REF=xxx] node scripts/apply-migrations.mjs
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
  console.error('Thiếu SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}
const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (res.ok) console.log(`OK: ${f}`);
  else {
    console.log(`FAIL: ${f} HTTP ${res.status} ${text.slice(0, 500)}`);
    process.exitCode = 1;
    break; // dừng để giữ thứ tự migration
  }
}
