// Guard thứ tự mặc định trang Danh mục hàng hóa.
//
// Bệnh đã gặp: trang không có sắp xếp mặc định nên lần render đầu theo thứ tự
// local (Dexie), khi dữ liệu server về thì đảo thứ tự -> dòng nháy 1 cái.
// Chốt: mặc định SKU giảm dần (hàng mới lên trên, cũ xuống dưới) ngay từ lần
// render đầu — cả 2 nguồn local/server đều ra cùng thứ tự nên không còn nháy.
//
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('danh mục: sắp xếp mặc định mới-trên-cũ-dưới', () => {
  const products = read('components/products/ProductsView.tsx');

  it("mặc định sortKey='sku', sortDir='desc' ngay từ lần render đầu", () => {
    assert.match(products, /useSortState\('sku', 'desc'\)/);
  });

  it('header Mã SKU vẫn bấm để đổi chiều (không khóa cứng)', () => {
    assert.match(products, /toggleSort/);
    assert.match(products, /sortKey="sku"/);
  });

  it('sort dùng helper dùng chung (locale vi, numeric)', () => {
    assert.match(products, /sortRows\(filteredProducts, get, sortDir\)/);
  });
});
