import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Đọc .env.local thủ công (không phụ thuộc dotenv) rồi verify quyền service_role:
// bypass RLS + gọi RPC generate_order_code.
function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)="([^"]*)"/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false } });

const { data: settings, error: e1 } = await admin.from('settings').select('key').limit(5);
console.log('settings read:', e1 ? `ERR ${e1.message}` : JSON.stringify(settings));

const { data: code, error: e2 } = await admin.rpc('generate_order_code', { prefix: 'HD' });
console.log('rpc generate_order_code:', e2 ? `ERR ${e2.message}` : code);

const { data: sku, error: e3 } = await admin.rpc('generate_master_code', { p_prefix: 'SP' });
console.log('rpc generate_master_code:', e3 ? `ERR ${e3.message}` : sku);
