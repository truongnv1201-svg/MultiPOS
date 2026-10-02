import { NextResponse } from 'next/server';

// Bản build nào đang chạy: Vercel tự gắn SHA commit lúc build (có cả runtime).
// Client (PwaRegister) lưu SHA lần đầu, các lần sau khác nhau = vừa deploy bản
// mới -> báo user tải lại. Local/dev không có biến này -> trả null, client tắt
// kiểm tra (dev đổi code là HMR, không cần báo bản mới).
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  return NextResponse.json({ sha });
}
