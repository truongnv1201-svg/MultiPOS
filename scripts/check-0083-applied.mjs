// Probe: 0083_role_guards đã lên prod chưa? Chạy: node scripts/check-0083-applied.mjs
// Chỉ dùng anon key trong .env.local (không in ra), gọi RPC is_counter_staff (không tham số).
// - Chưa apply: PostgREST PGRST202 "Could not find the function" (hàm chưa tồn tại).
// - Đã apply:  42501 permission denied (hàm tồn tại, anon đã bị REVOKE EXECUTE như thiết kế).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
const pick = (k) => raw.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, 'm'))?.[1];
const url = pick('NEXT_PUBLIC_SUPABASE_URL');
const anon = pick('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (!url || !anon) {
  console.error('Không đọc được NEXT_PUBLIC_SUPABASE_URL / ANON_KEY từ .env.local');
  process.exit(2);
}

const res = await fetch(`${url}/rest/v1/rpc/is_counter_staff`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: '{}',
});
const text = await res.text();
const code = (() => { try { return JSON.parse(text).code; } catch { return null; } })();

if (code === 'PGRST202' || /Could not find the function/.test(text)) {
  console.log('KET QUA: CHUA APPLY — is_counter_staff chưa tồn tại trên prod (0083 chưa chạy).');
  process.exitCode = 1;
} else if (code === '42501' || /permission denied/i.test(text)) {
  console.log('KET QUA: DA APPLY — is_counter_staff tồn tại, anon bị chặn EXECUTE (đúng thiết kế 0083).');
  process.exitCode = 0;
} else {
  console.log(`KET QUA: KHONG XAC DINH — HTTP ${res.status}: ${text.slice(0, 300)}`);
  process.exitCode = 2;
}
