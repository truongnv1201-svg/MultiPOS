const T = process.env.SUPABASE_ACCESS_TOKEN;
const r = await fetch((process.env.SUPABASE_MGMT_URL || 'https://api.supabase.com/v1/projects/' + (process.env.SUPABASE_PROJECT_REF || 'qrrryywrqkhggbenitsm') + '/database/query'), {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "update public.products set stock_quantity = 450 where sku = 'SP000001'" }),
});
console.log('restore SP000001 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 100));
