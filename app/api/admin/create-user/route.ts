import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const STAFF_ROLES = ['cashier', 'worker'] as const;
const ALL_ROLES = ['admin', 'manager', 'cashier', 'worker'] as const;

// POST /api/admin/create-user — Quản lý cửa hàng tự thêm nhân viên mới.
// Body: { email, password, full_name, role }
// Phân quyền:
//   - Chưa login / không có service_role -> 401/500
//   - admin   -> được tạo mọi role (admin/manager/cashier/worker)
//   - manager -> CHỈ được tạo cashier/worker (chặn leo quyền)
//   - cashier/worker -> 403
export async function POST(req: Request) {
  let body: { email?: string; password?: string; full_name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON không hợp lệ.' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = (body.password || '').trim();
  const full_name = (body.full_name || '').trim();
  const role = (body.role || '').trim();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Email nhân viên chưa hợp lệ.' }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Mật khẩu phải từ 6 ký tự trở lên.' }, { status: 400 });
  }
  if (!full_name) {
    return NextResponse.json({ error: 'Vui lòng nhập họ tên nhân viên.' }, { status: 400 });
  }
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Vai trò không hợp lệ.' }, { status: 400 });
  }

  // 1) Xác thực người gọi từ access_token (client gửi lên trong Authorization header)
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

  // 2) Lấy role người gọi (dùng admin client để vượt RLS khi đọc profiles)
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
    return NextResponse.json({ error: 'Chỉ Admin/Quản lý được thêm nhân viên!' }, { status: 403 });
  }
  // Manager chỉ được tạo thu ngân / thợ — chặn nâng lên admin/manager
  if (callerRole === 'manager' && !(STAFF_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json(
      { error: 'Quản lý chỉ được thêm Thu ngân (cashier) / Thợ (worker). Tạo Quản lý/Admin phải nhờ Admin.' },
      { status: 403 }
    );
  }

  // 3) Tạo auth user + profile qua Admin API (không đá session người gọi vì dùng service_role ở server)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (error) {
    const msg = /already|exists|registered/i.test(error.message)
      ? `Email ${email} đã tồn tại — dùng email khác hoặc reset mật khẩu cho NV cũ.`
      : error.message;
    return NextResponse.json({ error: `Không tạo được tài khoản: ${msg}` }, { status: 400 });
  }
  const newId = data?.user?.id;
  if (!newId) {
    return NextResponse.json({ error: 'Tạo user xong nhưng không lấy được id.' }, { status: 500 });
  }
  const { error: pErr } = await admin.from('profiles').upsert({ id: newId, full_name, role, email });
  if (pErr) {
    // Rollback best-effort: xóa auth user vừa tạo để khỏi rác
    await admin.auth.admin.deleteUser(newId).catch(() => {});
    return NextResponse.json({ error: `Tạo profile thất bại: ${pErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: newId, email, full_name, role });
}
