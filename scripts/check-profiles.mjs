const T = process.env.SUPABASE_ACCESS_TOKEN;
const r = await fetch('https://api.supabase.com/v1/projects/qrrryywrqkhggbenitsm/database/query', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select p.id, p.full_name, p.role, u.email, u.email_confirmed_at is not null as confirmed from public.profiles p join auth.users u on u.id = p.id` }),
});
console.log((await r.text()).slice(0, 600));
