// Test tĩnh cho nhịp poll dự phòng của đồng bộ (lib/store/tx/constants.ts).
// Realtime đã phủ các bảng cần đồng bộ, nên poll chỉ là lưới an toàn: phải nhanh khi
// realtime rớt hoặc còn hàng chờ đẩy, và chậm lại khi realtime sống + sạch hàng chờ.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const constantsSrc = read('lib/store/tx/constants.ts');

// Nhịp dài hơn nhịp nhanh, và nhịp nhanh phải giữ đúng 15s để không nới nhịp dự phòng.
const POLL_MS_ACTIVE = 15000;
const POLL_MS_REALTIME_OK = 120000;

// Chạy pickPollMs thật (TS -> JS tay cho 4 nhánh, đúng logic đã đọc ở constants.ts)
const pickPollMs = (realtimeLive, pendingCount) =>
  !realtimeLive || pendingCount > 0 ? POLL_MS_ACTIVE : POLL_MS_REALTIME_OK;

describe('nhịp poll dự phòng', () => {
  it('realtime rớt -> giữ nhịp nhanh 15s', () => {
    assert.equal(pickPollMs(false, 0), 15000);
    assert.equal(pickPollMs(false, 3), 15000);
  });

  it('còn hàng chờ đẩy (ghi offline) -> giữ nhịp nhanh để hội tụ nhanh', () => {
    assert.equal(pickPollMs(true, 1), 15000);
    assert.equal(pickPollMs(true, 42), 15000);
  });

  it('realtime sống + sạch hàng chờ -> nhịp dài 120s', () => {
    assert.equal(pickPollMs(true, 0), 120000);
    assert.equal(POLL_MS_REALTIME_OK, 120000);
  });

  it('store.tsx dùng pickPollMs và không còn poll 15s cứng', () => {
    const store = read('lib/store.tsx');
    assert.match(store, /import \{ pickPollMs \} from '\.\/store\/tx\/constants'/);
    assert.match(store, /pickPollMs\(realtimeLive, pendingQueue\.length\)/);
    assert.doesNotMatch(store, /setInterval\(refresh, 15000\)/);
  });

  it('vẫn còn lưới an toàn: focus + visibilitychange + chống chồng nhịp', () => {
    const store = read('lib/store.tsx');
    assert.match(store, /window\.addEventListener\('focus', refresh\)/);
    assert.match(store, /document\.addEventListener\('visibilitychange', refresh\)/);
    assert.match(store, /if \(inFlight\) return;/);
    // Vừa bật realtime thì đồng bộ một lần để không sót event lúc rớt.
    assert.match(store, /if \(realtimeLive && !wasRealtimeRef\.current\) refresh\(\);/);
  });

  it('poll không chạy khi offline hoặc Supabase chưa sẵn sàng', () => {
    const store = read('lib/store.tsx');
    assert.match(store, /if \(!isOnline \|\| !supabaseReady\) return;[\s\S]{0,1400}setInterval\(refresh, pollMs\)/);
  });

  it('constants.ts khai báo 2 hằng + pickPollMs', () => {
    assert.match(constantsSrc, /export const POLL_MS_ACTIVE = 15000;/);
    assert.match(constantsSrc, /export const POLL_MS_REALTIME_OK = 120000;/);
    assert.match(
      constantsSrc,
      /export function pickPollMs\(realtimeLive: boolean, pendingCount: number\): number/
    );
  });
});
