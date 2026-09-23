import { createClient } from '@supabase/supabase-js';

// Dùng trong Server Action / Route Handler cần quyền vượt RLS.
// KHÔNG import file này ở Client Component.
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !service) throw new Error('[supabase] Thiếu SERVICE_ROLE_KEY');
  return createClient(url, service, { auth: { persistSession: false } });
}
