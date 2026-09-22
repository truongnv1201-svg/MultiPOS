const T = process.env.SUPABASE_ACCESS_TOKEN;
async function q(query) {
  const r = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  console.log('Q:', query.slice(0, 110));
  console.log('A:', t.slice(0, 400));
}
// 1) Xóa đơn test sót 0013 + sổ/movement của nó
await q(`delete from public.cashbook_entries where reference_order_code = 'HD-260917-0013'`);
await q(`delete from public.stock_movements where reference_code = 'HD-260917-0013'`);
await q(`delete from public.orders where order_code = 'HD-260917-0013'`);
// 2) Dọn movement mồ côi (đơn verify đã xóa trước đây)
await q(`delete from public.stock_movements where reference_code like 'HD-%' and reference_code not in (select order_code from public.orders)`);
await q(`delete from public.cashbook_entries where reference_order_code like 'HD-%' and reference_order_code not in (select order_code from public.orders)`);
// 3) Dựng lại tồn SP000007 = seed(340) - tiêu thụ đơn thật hiện hữu (0009: 5 + combo 0007: 3x2 = 11)
await q(`update public.products set stock_quantity = 340 - (select coalesce(sum(i.material_consumed),0) from public.order_items i join public.orders o on o.id = i.order_id where i.sku = 'SP000007' and o.status != 'cancelled') - (select coalesce(sum(ci.quantity * i.quantity),0) from public.order_items i join public.orders o on o.id = i.order_id join public.combo_items ci on ci.combo_product_id = i.product_id join public.products cp on cp.id = ci.child_product_id and cp.sku = 'SP000007' where i.item_type = 'combo' and o.status != 'cancelled') where sku = 'SP000007'`);
await q(`select sku, stock_quantity from public.products where sku in ('SP000005','SP000006','SP000007','SP000008')`);
await q(`select count(*) as orders_left from public.orders`);
