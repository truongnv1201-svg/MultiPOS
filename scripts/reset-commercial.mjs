// Reset thương mại: xóa TOÀN BỘ dữ liệu giao dịch test, giữ master + tài khoản.
// Giữ: products, grinding_services, profiles, branches, settings (trừ seq chứng từ).
// Xóa: orders (+items cascade), cashbook, stock_movements, projects (+materials/attendance),
//       purchase_orders, shifts, customers. Tồn kho dựng lại đúng seed. Số chứng từ chạy lại từ 0001.
const T = process.env.SUPABASE_ACCESS_TOKEN;
if (!T) {
  console.error('Thieu SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}
async function q(query) {
  const r = await fetch('https://api.supabase.com/v1/projects/qrrryywrqkhggbenitsm/database/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  console.log('Q:', query.slice(0, 100).replace(/\n/g, ' '));
  console.log('A:', t.slice(0, 500));
}

console.log('=== TRƯỚC RESET ===');
await q(`select (select count(*) from public.orders) as orders, (select count(*) from public.cashbook_entries) as cashbook, (select count(*) from public.customers) as customers, (select count(*) from public.projects) as projects, (select count(*) from public.stock_movements) as movements`);

await q(`delete from public.order_items`);
await q(`delete from public.orders`);
await q(`delete from public.cashbook_entries`);
await q(`delete from public.stock_movements`);
await q(`delete from public.project_materials`);
await q(`delete from public.attendance_records`);
await q(`delete from public.projects`);
await q(`delete from public.purchase_orders`);
await q(`delete from public.shifts`);
await q(`delete from public.customers`);

// Dựng tồn về seed (theo migration 0007)
await q(`update public.products set stock_quantity = case sku
  when 'SP000001' then 450 when 'SP000002' then 320 when 'SP000003' then 280
  when 'SP000004' then 190 when 'SP000005' then 120 when 'SP000006' then 45
  when 'SP000007' then 340 when 'SP000008' then 60 when 'SP000009' then 0
  when 'SP000010' then 9999 when 'SP000011' then 9999 else stock_quantity end`);

// Số chứng từ chạy lại từ 0001 (giữ *_master_seq của SKU)
await q(`delete from public.settings where key like '%\\_seq' and key not like '%\\_master\\_seq'`);

console.log('=== SAU RESET ===');
await q(`select (select count(*) from public.orders) as orders, (select count(*) from public.cashbook_entries) as cashbook, (select count(*) from public.customers) as customers, (select count(*) from public.projects) as projects, (select count(*) from public.stock_movements) as movements, (select count(*) from public.products) as products, (select count(*) from public.profiles) as profiles`);
await q(`select sku, stock_quantity from public.products order by sku`);
await q(`select key from public.settings order by key`);
