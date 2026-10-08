// Guard bố cục 2 cột (bảng + panel chi tiết): panel TRỐNG phải cùng hình học với
// panel CÓ dữ liệu — lề đều nhờ container (gap-4 p-4), panel con không padding/margin
// riêng. Lịch sử: từng có `m-4` lồng trong container `p-4` (lề gấp đôi), và NCC từng
// dùng `p-4 pl-0` riêng trong khi KH dùng gap container (lệch khe giữa khi đổi tab).
// Nay KH + NCC chung 1 khung: main gap-4 p-4, panel w-96 không p-4.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const PAGES = {
  'khách hàng': 'components/customers/CustomersView.tsx',
  'nhà cung cấp': 'components/suppliers/SuppliersView.tsx',
  'đơn hàng': 'components/orders/OrdersView.tsx',
};

describe('panel trống cùng hình học panel có dữ liệu (lề đều 4 cạnh)', () => {
  for (const [name, file] of Object.entries(PAGES)) {
    it(`trang ${name}: panel trống không mang margin riêng`, () => {
      const src = read(file);
      assert.doesNotMatch(src, /m-4 items-center justify-center rounded-xl/);
    });

    it(`trang ${name}: panel trống là khung full cột, chữ ở giữa`, () => {
      const src = read(file);
      assert.match(src, /flex items-center justify-center text-slate-400 text-xs p-3/);
    });
  }

  it('KH + NCC chung khung 2 cot: main gap-4 p-4, panel khong padding rieng', () => {
    for (const f of [PAGES['khách hàng'], PAGES['nhà cung cấp']]) {
      const src = read(f);
      assert.match(src, /flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 overflow-hidden/);
      assert.ok(
        !/md:w-96 bg-slate-100 flex-col min-h-0 p-4/.test(src),
        `${f} panel không được mang p-4 riêng (lề do container gap-4 p-4 lo)`
      );
    }
  });
});

describe('font số: số 0 trơn + canh cột tabular (không phụ thuộc font máy)', () => {
  it('globals.css ép font-mono về sans hệ thống + tabular-nums', () => {
    const css = read('app/globals.css');
    assert.match(css, /--font-mono:\s*ui-sans-serif/);
    assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  });
});
