const T = process.env.SUPABASE_ACCESS_TOKEN;
async function q(query) {
  const r = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  console.log('Q:', query.slice(0, 100));
  console.log('A:', (await r.text()).slice(0, 1500));
}
await q(`select o.order_code, o.customer_name, o.total_amount, o.paid_amount, o.debt_amount, o.status, o.note, o.created_at, (select string_agg(sku || 'x' || quantity::text, ', ') from public.order_items i where i.order_id = o.id) as items from public.orders o order by o.created_at`);
await q(`select code, type, category, amount, reference_order_code, note from public.cashbook_entries order by created_at`);
