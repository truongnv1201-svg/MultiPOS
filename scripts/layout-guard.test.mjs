// Guard bố cục 2 cột (bảng + panel chi tiết): panel TRỐNG phải cùng hình học với
// panel CÓ dữ liệu — lề đều 4 cạnh nhờ container, không margin riêng.
// Bug từng gặp: panel trống mang `m-4` trong container đã `p-4` (lề gấp đôi),
// hoặc `p-4 pl-0` thiếu ở trang NCC (lệch phía khe giữa).
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

  it('trang NCC: panel trống giữ p-4 pl-0 như panel có dữ liệu (khe giữa đều)', () => {
    const src = read(PAGES['nhà cung cấp']);
    assert.match(src, /hidden md:flex w-full md:w-96 bg-slate-100 flex-col min-h-0 p-4 pl-0">\s*$/m);
  });
});

describe('font số: số 0 trơn + canh cột tabular (không phụ thuộc font máy)', () => {
  it('globals.css ép font-mono về sans hệ thống + tabular-nums', () => {
    const css = read('app/globals.css');
    assert.match(css, /--font-mono:\s*ui-sans-serif/);
    assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  });
});
