import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Apply 1 migration qua Management API (khi apply-migrations.mjs full bộ bị kẹt ở file lịch sử).
// Chạy: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-one.mjs 0024_cancel_reverse.sql
const REF = 'qrrryywrqkhggbenitsm';
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
