// Test tĩnh cho mirror cache Dexie (lib/store/tx/mirror.ts + các call site).
// Lỗi gốc: các hàm pull server ghi cache bằng `clear()` rồi `bulkAdd(bản chụp)`. Nếu có
// bản ghi được lưu cục bộ trong lúc server đang trả về, nó không có trong bản chụp và bị
// xoá khỏi cache. Với bản ghi đã lên server thì lần pull sau chữa lại được, nhưng với
// bản ghi CHƯA lên server (ghi offline, đang chờ hàng đợi) thì mất hẳn.
// Cách đúng: upsert + chỉ dọn khoá vốn có từ trước khi gọi server và không còn trong
// bản chụp mới (tức server đã xoá).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const mirror = read('lib/store/tx/mirror.ts');
const catalog = read('lib/store/catalog.tsx');
const projects = read('lib/store/tx/projects.tsx');
const shiftStock = read('lib/store/tx/shift-stock.tsx');
const hrm = read('lib/store/hrm-slice.tsx');
const ordersSync = read('lib/store/tx/orders-sync.ts');

describe('mirror cache Dexie: không xoá bản ghi ghi cục bộ trong lúc kéo', () => {
  it('helper upsert + dọn theo khoá có từ trước', () => {
    assert.match(mirror, /export async function cacheKeys<T>\(table: Table<T, string>\)/);
    assert.match(mirror, /table\.bulkPut\(next\)/);
    assert.match(mirror, /const removed = staleIds\.filter\(\(id\) => !nextIds\.has\(id\)\);/);
    assert.match(mirror, /table\.bulkDelete\(removed\)/);
  });

  it('không còn clear() + bulkAdd() trong bất kỳ đường pull nào', () => {
    const sites = [
      ['catalog.tsx', catalog],
      ['projects.tsx', projects],
      ['shift-stock.tsx', shiftStock],
      ['hrm-slice.tsx', hrm],
    ];
    for (const [name, src] of sites) {
      assert.doesNotMatch(src, /db\.[a-zA-Z]+\.clear\(\)/, `${name} vẫn còn clear() trong đường pull`);
    }
  });

  it('mọi đường pull đều chụp khoá cache TRƯỚC khi gọi server', () => {
    assert.match(catalog, /const \[staleProductIds, staleCustomerIds, staleSupplierIds\] = await Promise\.all\(\[\s*cacheKeys\(db\.products\)/);
    assert.match(catalog, /from\('products'\)\.select\('\*'\)\.order\('sku'\)/);
    assert.match(projects, /const staleProjectIds = await cacheKeys\(db\.projects\)/);
    assert.match(projects, /from\('projects'\)\.select\('\*'\)\.order\('code'\)/);
    assert.match(shiftStock, /const staleCashbookIds = await cacheKeys\(db\.cashbook\)/);
    assert.match(shiftStock, /from\('cashbook_entries'\)/);
    assert.match(hrm, /cacheKeys\(db\.employees\)/);
    assert.match(hrm, /cacheKeys\(db\.attendanceDays\)/);
  });

  it('mọi đường pull đều ghi cache qua mirrorUpsert', () => {
    assert.match(catalog, /mirrorUpsert\(db\.products, nextProducts, staleProductIds\)/);
    assert.match(catalog, /mirrorUpsert\(db\.customers, nextCustomers, staleCustomerIds\)/);
    assert.match(catalog, /mirrorUpsert\(db\.suppliers, nextSuppliers, staleSupplierIds\)/);
    assert.match(projects, /mirrorUpsert\(db\.projects, next, staleProjectIds\)/);
    assert.match(shiftStock, /mirrorUpsert\(db\.cashbook, next, staleCashbookIds\)/);
    assert.match(hrm, /mirrorUpsert\(db\.employees, rows, staleIds\)/);
    assert.match(hrm, /mirrorUpsert\(db\.attendanceDays, rows, staleIds\)/);
  });

  it('ghi cache catalog vẫn nằm trong transaction (3 bảng cùng lúc)', () => {
    assert.match(catalog, /db\.transaction\('rw', \[db\.products, db\.customers, db\.suppliers\]/);
  });

  it('đơn hàng vẫn dùng bulkPut (không hồi quy về clear)', () => {
    assert.match(ordersSync, /db\.orders\.bulkPut\(mapped\)/);
    assert.doesNotMatch(ordersSync, /db\.orders\.clear\(\)/);
  });

  it('xóa cache khi đăng xuất vẫn giữ nguyên (cố ý)', () => {
    const store = read('lib/store.tsx');
    assert.match(store, /db\.products\.clear\(\);/);
  });
});
