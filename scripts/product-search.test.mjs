// Unit test cho lib/product-search.ts (lọc + xếp tầng liên quan ở ô tìm POS).
// Case gốc: gõ "34" ra 262 món, "ỐNG TP 34 C2" (mã cũ) chìm khỏi top 8.
// Chạy: npm test (node --test scripts/product-search.test.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldAccents, rankProducts } from '../lib/product-search.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const P = (name, sku, extra = {}) => ({ name, sku, barcode: null, ...extra });
const names = (list) => list.map((p) => p.name);

describe('foldAccents', () => {
  it('bỏ dấu + đ/Đ, thường hóa, số giữ nguyên', () => {
    assert.equal(foldAccents('ỐNG TP 34 C2'), 'ong tp 34 c2');
    assert.equal(foldAccents('RÁP MỀM LÊ'), 'rap mem le');
    assert.equal(foldAccents('Đ'), 'd');
    assert.equal(foldAccents('340G'), '340g');
  });
});

describe('rankProducts', () => {
  const items = [
    P('RÁP MỀM LÊ 134', 'SP005088'),
    P('ỐNG TP 34 C2', 'SP005087'),
    P('34 LY NHỰA', 'SP009999'),
    P('KEO 502', 'SP005014'),
  ];

  it('"34": đầu tên > đầu từ > chứa (món cần lên top 8)', () => {
    assert.deepEqual(names(rankProducts(items, '34')), [
      '34 LY NHỰA',
      'ỐNG TP 34 C2',
      'RÁP MỀM LÊ 134',
    ]);
  });

  it('nhiều từ khóa AND: "34 c2" chỉ còn đúng món', () => {
    assert.deepEqual(names(rankProducts(items, '34 c2')), ['ỐNG TP 34 C2']);
    assert.deepEqual(names(rankProducts(items, '34 keo')), []);
  });

  it('có dấu luôn trước không dấu', () => {
    const list = [P('ỐNG NHỰA', 'SP000001'), P('PHONG VÂN', 'SP000002')];
    // "PHONG VÂN" chứa "ong" có dấu (tầng chứa), "ỐNG NHỰA" chỉ khớp không dấu
    assert.deepEqual(names(rankProducts(list, 'ong')), ['PHONG VÂN', 'ỐNG NHỰA']);
    // gõ có dấu thì trúng thẳng tầng cao, đứng đầu
    assert.equal(rankProducts(list, 'ống')[0].name, 'ỐNG NHỰA');
  });

  it('gõ đúng SKU/mã vạch nhảy lên đầu', () => {
    const list = [P('34 LY NHỰA', 'SP009999'), P('ỐNG TP 34 C2', 'SP005087')];
    assert.equal(rankProducts(list, 'SP005087')[0].name, 'ỐNG TP 34 C2');
    const withBarcode = [P('A', 'X1', { barcode: '893456789' }), P('B', 'X2', { barcode: null })];
    assert.equal(rankProducts(withBarcode, '893456')[0].name, 'A');
  });

  it('trống / khoảng trắng -> [] (dropdown đóng)', () => {
    assert.deepEqual(rankProducts(items, ''), []);
    assert.deepEqual(rankProducts(items, '   '), []);
  });

  it('đồng điểm giữ thứ tự danh mục cũ (ổn định)', () => {
    const list = [P('A 34 X', 'SP000001'), P('B 34 Y', 'SP000002')];
    assert.deepEqual(names(rankProducts(list, '34')), ['A 34 X', 'B 34 Y']);
  });

  // Ca thật 10/2026: gõ "mặt S 2" không ra "MẶT S 2 Ổ 1 LỖ".
  // Trước khi sửa: món đó hạng 13/61 (bị 12 món chỉ tình cờ có chữ "mặt" + số "2"
  // đè lên), nên bị top 8 cắt mất.
  describe('cả cụm từ liền mạch: "mặt S 2"', () => {
    const list = [
      P('BĂNG DÁN MẶT TRẮNG XỊN 2 1CM', 'SP000366'),
      P('BĂNG DÁN 2 MẶT XANH', 'SP000370'),
      P('MÀI VÁT 12LY 2 MẶT', 'SP002898'),
      P('MẶT S 1 Ổ 2 LỖ', 'SP002920'),
      P('MẶT S 2 Ổ 1 LỖ', 'SP002923'),
      P('MẶT S 2 Ổ 2 LỖ', 'SP002924'),
      P('MẶT S 2 Ổ', 'SP002925'),
      P('MẶT S 3 Ổ', 'SP002926'),
    ];

    it('món đúng lên top, đám khớp rời rạc bị loại hẳn', () => {
      const got = names(rankProducts(list, 'mặt S 2'));
      assert.deepEqual(got.slice(0, 3), ['MẶT S 2 Ổ 1 LỖ', 'MẶT S 2 Ổ 2 LỖ', 'MẶT S 2 Ổ']);
      assert.ok(!got.includes('BĂNG DÁN MẶT TRẮNG XỊN 2 1CM'));
      assert.ok(!got.includes('BĂNG DÁN 2 MẶT XANH'));
      assert.ok(!got.includes('MẶT S 3 Ổ'));
      // "MẶT S 1 Ổ 2 LỖ" vẫn khớp (có số 2) nhưng phải nằm dưới nhóm đúng cụm.
      assert.ok(got.indexOf('MẶT S 1 Ổ 2 LỖ') > 2);
    });

    it('gõ không dấu cho cùng thứ tự', () => {
      const got = names(rankProducts(list, 'mat s 2'));
      assert.deepEqual(got.slice(0, 3), ['MẶT S 2 Ổ 1 LỖ', 'MẶT S 2 Ổ 2 LỖ', 'MẶT S 2 Ổ']);
    });

    it('gõ tắt "mặt 2" (hai từ cách quãng) vẫn ra đúng nhóm S 2', () => {
      const got = names(rankProducts(list, 'mặt 2'));
      assert.deepEqual(got.slice(0, 3), ['MẶT S 2 Ổ 1 LỖ', 'MẶT S 2 Ổ 2 LỖ', 'MẶT S 2 Ổ']);
      // Món chỉ tình cờ có "mặt" ... "2" (cách xa, không bắt đầu tên) phải nằm sau.
      const noise = got.indexOf('BĂNG DÁN MẶT TRẮNG XỊN 2 1CM');
      assert.ok(noise === -1 || noise > 2);
    });

    it('từ 1 ký tự không khớp vào mã SP... của mọi món', () => {
      // "s" từng khớp mọi SKU vì đều bắt đầu bằng "SP" -> kết quả loãng.
      assert.deepEqual(rankProducts([P('KEO 502', 'SP005014')], 'mặt s 2'), []);
    });
  });

  it('POS cắm rankProducts + cắt 30 dòng (wiring)', () => {
    const src = read('components/pos/ProductSearchBar.tsx');
    assert.match(src, /rankProducts\(/);
    assert.match(src, /from '@\/lib\/product-search'/);
    assert.match(src, /\.slice\(0, 30\)/);
  });
});
