// Unit test cho mã SP tự sinh nối tiếp (lib/db.ts maxSpNumber + addProduct).
// Bối cảnh: masterSeq = 12 cứng trong RAM nên project mới nào cũng bắt đầu
// SP000013, tải lại trang là trùng mã cũ. Mã giờ nối tiếp số lớn nhất đang có.
// Chạy: npm test (node --test). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maxSpNumber, maxCodeNumber, nextDailyCode, dailyCodeStamp } from '../lib/codes.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('maxSpNumber', () => {
  it('danh mục trống -> 0 (mã đầu là SP000001)', () => {
    assert.equal(maxSpNumber([]), 0);
  });
  it('lấy số lớn nhất, bỏ qua mã sai định dạng', () => {
    assert.equal(maxSpNumber([{ sku: 'SP000013' }, { sku: 'SP000016' }, { sku: 'SP000014' }]), 16);
    assert.equal(maxSpNumber([{ sku: 'KHO-1' }, { sku: '' }, {}]), 0);
  });
  it('không phân biệt đệm 0 / hoa thường', () => {
    assert.equal(maxSpNumber([{ sku: 'sp13' }, { sku: 'SP000009' }]), 13);
  });
});

describe('maxCodeNumber (dùng chung SP/KH/NCC)', () => {
  it('KH/NCC nối tiếp số lớn nhất, không lấp số đã xóa', () => {
    assert.equal(maxCodeNumber(['KH0001', 'KH0003', 'KH0004'], 'KH'), 4);
    assert.equal(maxCodeNumber(['NCC0002'], 'NCC'), 2);
    assert.equal(maxCodeNumber([], 'KH'), 0);
  });
});

describe('nextDailyCode (mã phiếu NH/PQ nối tiếp theo ngày)', () => {
  it('ngày mới bắt đầu 0001', () => {
    assert.equal(nextDailyCode([], 'NH', '261006'), 'NH-261006-0001');
  });

  it('nối tiếp số lớn nhất cùng ngày, khác ngày bỏ qua', () => {
    assert.equal(
      nextDailyCode(['NH-261006-0001', 'NH-261006-0005', 'NH-261005-0009'], 'NH', '261006'),
      'NH-261006-0006'
    );
  });

  it('đọc được mã cũ có hậu tố random (không lùi số)', () => {
    assert.equal(nextDailyCode(['NH-261006-0011-20yvhe'], 'NH', '261006'), 'NH-261006-0012');
  });

  it('khác prefix không lẫn nhau, sai định dạng bỏ qua', () => {
    assert.equal(nextDailyCode(['PQ-261006-0003', 'nh-261006-xx', ''], 'NH', '261006'), 'NH-261006-0001');
  });

  it('dailyCodeStamp ra YYMMDD giờ local', () => {
    assert.match(dailyCodeStamp(new Date(2026, 9, 6)), /^261006$/);
  });
});

describe('addProduct dùng mã nối tiếp', () => {
  it('lấy maxSpNumber(products), retry cũng nối tiếp (không gọi masterSeq cứng)', () => {
    const catalog = read('lib/store/catalog.tsx');
    assert.match(catalog, /maxSpNumber\(products\)/);
    assert.match(catalog, /const takeSku = \(\) => \{/);
    assert.ok(!/generateMasterCode\('SP'\)/.test(catalog), 'không còn sinh mã từ counter cứng');
  });

  it('không còn import chết generateMasterCode', () => {
    assert.ok(!/^\s*generateMasterCode,$/m.test(read('lib/store.tsx')), 'store.tsx còn import thừa');
  });

  it('KH/NCC cùng quy tắc max (không lấp số đã xóa)', () => {
    const catalog = read('lib/store/catalog.tsx');
    assert.match(catalog, /maxCodeNumber\(\s*\n?\s*customers\.map\(\(c\) => c\.code\),\s*\n?\s*'KH'/);
    assert.match(catalog, /maxCodeNumber\(\s*\n?\s*suppliers\.map\(\(s\) => s\.code\),\s*\n?\s*'NCC'/);
  });
});
