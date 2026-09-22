import { createClient } from '@supabase/supabase-js';

// Client dùng ở browser / Client Component. Chỉ dùng ANON key.
// Source of Truth vẫn là Postgres qua RLS + RPC (Invariant #5).
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) {
    console.warn('[supabase] Thiếu NEXT_PUBLIC_SUPABASE_URL / ANON_KEY — đang chạy chế độ Dexie local-only.');
  }
  return createClient(url, anon);
}
