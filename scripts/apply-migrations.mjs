import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Apply toàn bộ supabase/migrations lên project qua Management API.
// Chạy: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-migrations.mjs
// P1 guard:
// - 0017_payroll.sql là file LỊCH SỬ (header cấm rerun, FAIL trên schema hiện tại sau
//   rebuild 0019/0021) -> mặc định SKIP, chỉ chạy khi truyền --include-0017.
// - Preflight: 0024/0025/0026/0028 là chuỗi fix liên hoàn, thiếu file nào thì dừng và báo.
// - Môi trường còn kẹt HRM giữa 0014-0018: backup DB trước khi cho nhảy lên 0019+.
const REF = 'qrrryywrqkhggbenitsm';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Thiếu SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}
const dir = join(process.cwd(), 'supabase', 'migrations');
const include0017 = process.argv.includes('--include-0017');
const REQUIRED_CHAIN = ['0024_cancel_reverse.sql', '0025_return_restock.sql', '0026_return_idempotent.sql', '0028_checkout_guards.sql', '0029_checkout_idempotent.sql'];
const allFiles = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const missing = REQUIRED_CHAIN.filter((f) => !allFiles.includes(f));
if (missing.length > 0) {
  console.error(`Thiếu migration bắt buộc trong chuỗi 0024-0028: ${missing.join(', ')} — dừng để khỏi apply lệch thứ tự.`);
  process.exit(1);
}
const files = allFiles.filter((f) => include0017 || f !== '0017_payroll.sql');
if (!include0017 && allFiles.includes('0017_payroll.sql')) {
  console.log('SKIP: 0017_payroll.sql (file lịch sử — xem header file; cần thì --include-0017)');
}
console.log('CẢNH BÁO: nếu DB còn kẹt HRM giữa 0014-0018, backup trước khi migrate lên 0019+ (drop bảng cũ).');

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
