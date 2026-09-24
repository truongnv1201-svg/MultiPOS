import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Seed catalog mẫu cho cửa hàng mới / project trắng (P4b).
// Idempotent: upsert theo sku nên chạy lại không trùng.
// Chạy: node scripts/seed-catalog.mjs   (cần service_role trong .env.local)
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

const ROWS = [
  { sku: 'SP000001', name: 'Keo silicone', category: 'Keo', unit: 'chai', product_type: 'goods', retail_price: 60000, stock_quantity: 100 },
  { sku: 'SP000002', name: 'Xi măng', category: 'Vật tư', unit: 'bao', product_type: 'goods', retail_price: 85000, stock_quantity: 200 },
  { sku: 'SP000003', name: 'Cát vàng', category: 'Vật tư', unit: 'm3', product_type: 'goods', retail_price: 450000, stock_quantity: 50 },
  { sku: 'SP000004', name: 'Kính cường lực 10ly', category: 'Kính', unit: 'm2', product_type: 'area', retail_price: 750000, stock_quantity: 100 },
  { sku: 'SP000005', name: 'Công lắp đặt', category: 'Dịch vụ', unit: 'lần', product_type: 'service', retail_price: 150000, stock_quantity: 0 },
];

const { data, error } = await admin.from('products').upsert(ROWS, { onConflict: 'sku' }).select('sku,name');
if (error) {
  console.log(`FAIL: ${error.message}`);
  process.exit(1);
}
console.log(`OK catalog mẫu: ${data.map((r) => r.sku).join(', ')}`);
