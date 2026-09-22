import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)="([^"]*)"/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log('URL:', URL);
console.log('ANON prefix:', ANON?.slice(0, 20) + '... len=' + ANON?.length);

const supa = createClient(URL, ANON);
for (const [email, pw] of [
  ['cashier@multipos.local', 'Cashier@123'],
  ['admin@multipos.local', 'Admin@123'],
]) {
  const { data, error } = await supa.auth.signInWithPassword({ email, password: pw });
  console.log(email, '=>', error ? `ERR ${error.status} ${error.message}` : `OK uid=${data.user?.id}`);
  await supa.auth.signOut();
}
