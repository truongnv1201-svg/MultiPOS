// Guard chặn dropdown "Thông tin đã lưu"/autofill của trình duyệt trên toàn app.
// Trình duyệt bật gợi ý đã lưu ở hầu hết ô text, đè lên dropdown gợi ý của app và
// nuốt phím mũi tên/Enter. Cách chặn: component NoBrowserAutofill gắn trong root
// layout, gắn autocomplete="off" cho mọi input/textarea (kể cả node mount sau).
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('autofill: tắt gợi ý đã lưu của trình duyệt trên toàn app', () => {
  it('root layout gắn NoBrowserAutofill (mọi màn đều đi qua đây)', () => {
    const layout = read('app/layout.tsx');
    assert.match(layout, /import \{NoBrowserAutofill\} from '@\/components\/common\/NoBrowserAutofill'/);
    assert.match(layout, /<NoBrowserAutofill \/>/);
  });

  it('quét mọi input/textarea + theo dõi node mới (modal, sheet, màn render sau)', () => {
    const src = read('components/common/NoBrowserAutofill.tsx');
    assert.match(src, /querySelectorAll<Field>\('input, textarea'\)/);
    assert.match(src, /new MutationObserver/);
    assert.match(src, /childList: true, subtree: true/);
    assert.match(src, /setAttribute\('autocomplete', 'off'\)/);
  });

  it('không phá đăng nhập: bỏ qua ô đã tự khai báo autocomplete và ô mật khẩu', () => {
    const src = read('components/common/NoBrowserAutofill.tsx');
    assert.match(src, /hasAttribute\('autocomplete'\)/);
    assert.match(src, /hasAttribute\('data-autofill'\)/);
    assert.match(src, /'password'/);
    // LoginModal khai báo rõ username/current-password -> sweep bỏ qua, password manager vẫn chạy
    const login = read('components/auth/LoginModal.tsx');
    assert.match(login, /autoComplete="username"/);
    assert.match(login, /autoComplete="current-password"/);
  });
});
