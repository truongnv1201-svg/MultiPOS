// Unit test cho mã SP tự sinh nối tiếp (lib/db.ts maxSpNumber + addProduct).
// Bối cảnh: masterSeq = 12 cứng trong RAM nên project mới nào cũng bắt đầu
// SP000013, tải lại trang là trùng mã cũ. Mã giờ nối tiếp số lớn nhất đang có.
// Chạy: npm test (node --test). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maxSpNumber } from '../lib/codes.ts';

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

describe('addProduct dùng mã nối tiếp', () => {
  it('lấy maxSpNumber(products), retry cũng nối tiếp (không gọi masterSeq cứng)', () => {
    const catalog = read('lib/store/catalog.tsx');
    assert.match(catalog, /maxSpNumber\(products\)/);
    assert.match(catalog, /const takeSku = \(\) => \{/);
    assert.ok(!/generateMasterCode\('SP'\)/.test(catalog), 'không còn sinh mã từ counter cứng');
  });
});
