// Unit test cho lib/format.ts (parse chuỗi kiểu VN).
// Chạy: npm test (node --test). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatVND, formatNumber, parseFormattedNumber } from '../lib/format.ts';

describe('formatVND đọc đúng chuỗi kiểu VN', () => {
  it('số giữ nguyên', () => {
    assert.equal(formatVND(5050000), '5.050.000 đ');
    assert.equal(formatVND(0), '0 đ');
  });
  it('"1.234.567" (chấm nghìn) -> 1234567, không còn lệch 10^6', () => {
    assert.equal(formatVND('1.234.567'), '1.234.567 đ');
  });
  it('"2,5" (phẩy thập phân) -> làm tròn 3', () => {
    assert.equal(formatVND('2,5'), '3 đ');
  });
  it('null/undefined/rỗng -> 0 đ', () => {
    assert.equal(formatVND(null), '0 đ');
    assert.equal(formatVND(undefined), '0 đ');
    assert.equal(formatVND(''), '0 đ');
  });
});

describe('formatNumber đọc đúng chuỗi kiểu VN', () => {
  it('"1.234.567" -> 1234567', () => {
    assert.equal(formatNumber('1.234.567'), '1.234.567');
  });
  it('số thập phân theo decimals', () => {
    assert.equal(formatNumber('2,5', 1), '2,5');
    assert.equal(formatNumber(1234.567, 2), '1.234,57');
  });
});

describe('parseFormattedNumber (đối chứng)', () => {
  it('"1.234.567" -> 1234567', () => {
    assert.equal(parseFormattedNumber('1.234.567'), 1234567);
  });
});
