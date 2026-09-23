import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Seed 2 tài khoản demo qua Admin API (cần service_role trong .env.local).
// Chạy: node scripts/seed-users.mjs
// ĐỔI MẬT KHẨU NGAY sau khi đăng nhập lần đầu (Dashboard > Authentication > Users).
function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)="([^"]*)"/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnv();

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const USERS = [
  { email: 'admin@multipos.local', password: 'Admin@123', full_name: 'Quản trị viên', role: 'admin' },
  { email: 'cashier@multipos.local', password: 'Cashier@123', full_name: 'Nguyễn Văn A (Thu ngân)', role: 'cashier' },
];

for (const u of USERS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name, role: u.role },
  });
  if (error && !error.message.toLowerCase().includes('already')) {
    console.log(`FAIL ${u.email}: ${error.message}`);
    continue;
  }
  const id = data?.user?.id;
  if (!id) {
    // Đã tồn tại: lấy id qua list
    const { data: listed } = await admin.auth.admin.listUsers();
    const found = listed?.users?.find((x) => x.email === u.email);
    if (!found) {
      console.log(`SKIP ${u.email}: không lấy được id`);
      continue;
    }
    await admin.from('profiles').upsert({ id: found.id, full_name: u.full_name, role: u.role });
    console.log(`OK ${u.email} (đã tồn tại, upsert profile)`);
    continue;
  }
  const { error: pErr } = await admin.from('profiles').upsert({ id, full_name: u.full_name, role: u.role });
  console.log(pErr ? `FAIL profile ${u.email}: ${pErr.message}` : `OK ${u.email} / ${u.password}`);
}
