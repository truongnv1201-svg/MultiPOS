import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Bản build nào đang chạy: SHA commit (Vercel gắn lúc build, có cả runtime) +
// ngày build CalVer (next.config.ts ghi public/build-info.json mỗi lần build).
// Client (PwaRegister so SHA báo bản mới; chip header hiện ngày + SHA).
// Local/dev không có biến/file -> trả null, client tắt kiểm tra + hiện 'dev'.
export const dynamic = 'force-dynamic';

export async function GET() {
  let date: string | null = null;
  let fileSha: string | null = null;
  try {
    const raw = await readFile(join(process.cwd(), 'public', 'build-info.json'), 'utf8');
    const info = JSON.parse(raw) as { date?: unknown; sha?: unknown };
    if (typeof info.date === 'string' && info.date !== 'dev') date = info.date;
    if (typeof info.sha === 'string' && info.sha !== 'dev') fileSha = info.sha;
  } catch {
    /* build cũ / dev: fallback null */
  }
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || fileSha || null;
  return NextResponse.json({ sha, date });
}
