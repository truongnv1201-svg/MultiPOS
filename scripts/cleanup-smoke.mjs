const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const res = await fetch(
  'https://api.supabase.com/v1/projects/qrrryywrqkhggbenitsm/database/query',
  {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "delete from public.orders where customer_name = 'Smoke Test'" }),
  },
);
console.log('cleanup HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
