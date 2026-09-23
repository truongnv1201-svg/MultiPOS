import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const STAFF_ROLES = ['cashier', 'worker'] as const;

// POST /api/admin/reset-password — Đặt lại mật khẩu cho nhân viên.
// Body: { user_id, password }
// Phân quyền:
//   - admin   -> đặt lại mọi tài khoản (kể cả admin/manager khác)
//   - manager -> CHỈ cashier/worker (không chạm admin/manager, kể cả chính mình nâng quyền)
//   - cashier/worker -> 403
export async function POST(req: Request) {
  let body: { user_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON không hợp lệ.' }, { status: 400 });
  }

  const userId = (body.user_id || '').trim();
  const password = (body.password || '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'Thiếu user_id.' }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Mật khẩu phải từ 6 ký tự trở lên.' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: 'Chưa cấu hình Supabase.' }, { status: 500 });
  }
  const callerClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.' }, { status: 401 });
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: 'Server chưa cấu hình SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .maybeSingle();
  const callerRole = (callerProfile as { role?: string } | null)?.role;
  if (callerRole !== 'admin' && callerRole !== 'manager') {
    return NextResponse.json({ error: 'Chỉ Admin/Quản lý được đặt lại mật khẩu!' }, { status: 403 });
  }

  // Lấy role của tài khoản đích để chặn leo quyền
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('role, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (!targetProfile) {
    return NextResponse.json({ error: 'Không tìm thấy tài khoản này.' }, { status: 404 });
  }
  const targetRole = (targetProfile as { role?: string }).role || '';
  if (callerRole === 'manager' && !(STAFF_ROLES as readonly string[]).includes(targetRole)) {
    return NextResponse.json(
      { error: 'Quản lý chỉ được đặt lại mật khẩu Thu ngân / Thợ.' },
      { status: 403 }
    );
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    return NextResponse.json({ error: `Đặt lại mật khẩu thất bại: ${error.message}` }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
