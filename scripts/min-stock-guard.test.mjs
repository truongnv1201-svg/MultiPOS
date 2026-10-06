// Guard tồn tối thiểu (min_stock) — single source ở lib/stock.ts.
//
// Quyết định nghiệp vụ đã chốt:
//   1. Mỗi mặt hàng có ngưỡng riêng (min_stock); trống/<=0 = "chưa cấu hình"
//      -> rơi về DEFAULT_MIN_STOCK (15) để giữ đúng hành vi cảnh báo cũ.
//   2. Mọi màn hình (Danh mục, Kho) PHẢI dùng helper dùng chung, cấm hardcode
//      ngưỡng số (15/20) trong component — trước đây cảnh báo "Sắp hết" cứng 15
//      còn cột "Tồn tối thiểu" chỉ để trưng trong Excel.
//   3. Form thêm/sửa hàng hóa phải cho nhập tồn tối thiểu (trước đây chỉ Excel
//      mới set được).
//
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_MIN_STOCK,
  minStockOf,
  isOutOfStock,
  isLowStock,
  stockStatus,
} from '../lib/stock.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('min_stock: helper dùng chung', () => {
  it('mặc định 15 khi trống/0/âm/chuỗi rác', () => {
    assert.equal(DEFAULT_MIN_STOCK, 15);
    assert.equal(minStockOf({}), 15);
    assert.equal(minStockOf({ min_stock: undefined }), 15);
    assert.equal(minStockOf({ min_stock: 0 }), 15);
    assert.equal(minStockOf({ min_stock: -5 }), 15);
    assert.equal(minStockOf({ min_stock: NaN }), 15);
  });

  it('tôn trọng ngưỡng riêng khi > 0', () => {
    assert.equal(minStockOf({ min_stock: 5 }), 5);
    assert.equal(minStockOf({ min_stock: 100 }), 100);
  });

  it('hết hàng khi tồn <= 0 (kể cả tồn âm do dữ liệu cũ)', () => {
    assert.equal(isOutOfStock({ stock_quantity: 0 }), true);
    assert.equal(isOutOfStock({ stock_quantity: -2 }), true);
    assert.equal(isOutOfStock({ stock_quantity: 1 }), false);
  });

  it('sắp hết khi còn hàng nhưng chạm/ngã dưới ngưỡng', () => {
    assert.equal(isLowStock({ stock_quantity: 15 }), true); // chạm ngưỡng mặc định
    assert.equal(isLowStock({ stock_quantity: 16 }), false);
    assert.equal(isLowStock({ stock_quantity: 5, min_stock: 5 }), true);
    assert.equal(isLowStock({ stock_quantity: 6, min_stock: 5 }), false);
    assert.equal(isLowStock({ stock_quantity: 0 }), false); // hết hàng không tính là sắp hết
  });

  it('stockStatus ra đúng 1 trong 3 trạng thái', () => {
    assert.equal(stockStatus({ stock_quantity: 0 }), 'out');
    assert.equal(stockStatus({ stock_quantity: 10 }), 'low');
    assert.equal(stockStatus({ stock_quantity: 16 }), 'ok');
    assert.equal(stockStatus({ stock_quantity: 4, min_stock: 5 }), 'low');
    assert.equal(stockStatus({ stock_quantity: 6, min_stock: 5 }), 'ok');
  });
});

describe('min_stock: wiring UI', () => {
  const products = read('components/products/ProductsView.tsx');
  const inventory = read('components/inventory/InventoryView.tsx');
  const addForm = read('components/products/AddProductFormModal.tsx');

  it('không còn hardcode ngưỡng 15/20 trong logic tồn của 2 màn', () => {
    for (const [name, src] of [['ProductsView', products], ['InventoryView', inventory]]) {
      assert.ok(!/stock_quantity\s*<=\s*15/.test(src), `${name} cấm so sánh cứng <= 15`);
      assert.ok(!/stock_quantity\s*>\s*15/.test(src), `${name} cấm so sánh cứng > 15`);
      assert.ok(!/stock_quantity\s*<\s*20/.test(src), `${name} cấm so sánh cứng < 20`);
    }
  });

  it('Danh mục dùng helper dùng chung (tab tồn Kho đã bỏ)', () => {
    assert.match(products, /from '@\/lib\/stock'/);
    assert.ok(/isLowStock\(p\)/.test(products), 'ProductsView phải dùng isLowStock');
    assert.ok(/isOutOfStock\(p\)/.test(products), 'ProductsView phải dùng isOutOfStock');
    assert.ok(!/stock_quantity\s*<=\s*15/.test(inventory), 'InventoryView cấm so sánh cứng <= 15');
  });

  it('form thêm và form sửa đều có ô tồn tối thiểu', () => {
    assert.match(addForm, /Tồn tối thiểu/);
    assert.match(addForm, /setMinStock/);
    assert.match(products, /editMinStock/);
    assert.match(products, /Tồn tối thiểu \(báo sắp hết\)/);
  });

  it('lưu min_stock đi qua cả thêm và sửa (ô trống = lưu 0 = mặc định)', () => {
    assert.match(addForm, /minStock === ''\s*\?\s*0/);
    assert.match(products, /editMinStock === ''\s*\?\s*0/);
    // Dịch vụ/combo không giữ ngưỡng tồn.
    assert.match(addForm, /productType === 'service' \|\| productType === 'combo'/);
    assert.match(products, /editProductType === 'service' \|\| editProductType === 'combo'/);
  });

  it('prefill form sửa chỉ hiện số khi > 0 (0/undefined = dùng mặc định)', () => {
    assert.match(products, /p\.min_stock && p\.min_stock > 0 \? p\.min_stock : ''/);
  });

  it('ô tồn tối thiểu cho nhập thập phân (hàng m² có ngưỡng lẻ như 2.5)', () => {
    assert.match(products, /Tồn tối thiểu \(báo sắp hết\)[\s\S]{0,300}allowDecimals/);
  });

  it('nhãn bộ lọc không còn ghi số cứng 15', () => {
    assert.ok(!/≤ 15/.test(products), 'ProductsView không ghi ≤ 15');
    assert.ok(!/≤ ?15/.test(inventory), 'InventoryView không ghi ≤15');
  });
});
