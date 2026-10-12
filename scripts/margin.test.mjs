// Cộng % trên vốn nhập (máy tính giá bán ở form thêm/sửa hàng hóa).
// - Công thức thuần ở lib/costing.ts: giá = tròn từng đồng(vốn × (1+m%)).
//   KHÔNG làm tròn nghìn (hàng nhạy giá như dây điện biến động từng đồng).
// - UI: form Thêm + Sửa dùng chung MarginCalcField; danh mục hiện biên lãi.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lineMargin,
  priceFromMarkup,
  markupFromPrice,
} from '../lib/costing.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('priceFromMarkup: cộng % trên vốn nhập, tròn từng đồng', () => {
  it('vốn 100000 + 30% = 130000', () => {
    assert.equal(priceFromMarkup(100000, 30), 130000);
  });

  it('không làm tròn nghìn: dây 45500 + 12.5% = 51188 (51187.5 tròn đồng)', () => {
    assert.equal(priceFromMarkup(45500, 12.5), 51188);
  });

  it('% = 0 giữ nguyên vốn (tròn đồng)', () => {
    assert.equal(priceFromMarkup(99999.4, 0), 99999);
  });

  it('% âm (giảm giá) vẫn tính: 100000 - 10% = 90000', () => {
    assert.equal(priceFromMarkup(100000, -10), 90000);
  });

  it('vốn 0/rác -> 0 (không chia 0, không giá ma)', () => {
    assert.equal(priceFromMarkup(0, 30), 0);
    assert.equal(priceFromMarkup(null, 30), 0);
    assert.equal(priceFromMarkup(undefined, 30), 0);
  });

  it('% rác coi như 0', () => {
    assert.equal(priceFromMarkup(100000, null), 100000);
    assert.equal(priceFromMarkup(100000, undefined), 100000);
  });

  it('kẹp không âm khi % < -100', () => {
    assert.equal(priceFromMarkup(100000, -150), 0);
  });
});

describe('markupFromPrice: suy % ngược từ cặp vốn-giá', () => {
  it('vốn 100000 giá 130000 -> 30%', () => {
    assert.ok(Math.abs(markupFromPrice(100000, 130000) - 30) < 1e-9);
  });

  it('vốn 0 -> 0 (khỏi chia 0)', () => {
    assert.equal(markupFromPrice(0, 50000), 0);
    assert.equal(markupFromPrice(null, 50000), 0);
  });
});

describe('biên hiển thị khớp lineMargin có sẵn', () => {
  it('giá 130000 vốn 100000 -> lãi 30000, biên 23.08% trên giá bán', () => {
    const m = lineMargin(130000, 100000);
    assert.equal(m.amount, 30000);
    assert.ok(Math.abs(m.pct - 23.0769) < 0.01);
  });
});

describe('margin: wiring UI (chống nhân bản logic)', () => {
  const addForm = read('components/products/AddProductFormModal.tsx');
  const products = read('components/products/ProductsView.tsx');
  const field = read('components/products/MarginCalcField.tsx');

  it('công thức sống duy nhất ở lib/costing.ts', () => {
    assert.match(read('lib/costing.ts'), /export function priceFromMarkup/);
    assert.match(read('lib/costing.ts'), /export function markupFromPrice/);
    // Component không hardcode công thức (phải gọi helper dùng chung).
    assert.ok(!/c \* \(1 \+/.test(field), 'MarginCalcField cấm tính tay, phải gọi priceFromMarkup');
    assert.match(field, /priceFromMarkup/);
    assert.match(field, /markupFromPrice/);
    assert.match(field, /lineMargin/);
  });

  it('form thêm và form sửa dùng chung MarginCalcField', () => {
    assert.match(addForm, /MarginCalcField/);
    assert.match(products, /MarginCalcField/);
  });

  it('component ẩn khi cả 2 vốn đều 0 (dịch vụ/combo/hàng chưa nhập)', () => {
    assert.ok(/c <= 0 && a <= 0/.test(field), 'MarginCalcField phải tự ẩn khi không có vốn');
  });

  it('form thêm/sửa giấu cụm % với service/combo', () => {
    assert.match(addForm, /productType !== 'service' && productType !== 'combo' && \(\s*\n?\s*<MarginCalcField/);
    assert.match(products, /editProductType !== 'service' && editProductType !== 'combo' && \(\s*\n?\s*<MarginCalcField/);
  });

  it('form sửa truyền vốn BQ làm tham chiếu (không dùng để tính giá)', () => {
    assert.match(products, /avgCost=\{editingProduct\?\.avg_cost\}/);
  });

  it('danh mục hiện biên lãi dưới giá bán + sắp xếp được theo biên', () => {
    assert.match(products, /lineMargin\(p\.retail_price, p\.avg_cost\)/);
    assert.match(products, /handleSort\('margin'\)/);
    assert.match(products, /margin: \(p\) =>/);
  });
});
