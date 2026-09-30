// Test tĩnh cho phép kéo biến động kho (lib/store/tx/shift-stock.tsx + InventoryView).
// Bảng stock_movements là nặng nhất trong đồng bộ: đo thực tế 1 lần bán kéo lại
// ~500 KB, trong đó stock_movements ~217 KB. Bỏ JOIN products(name) chỉ giảm ~10%
// (tên lặp lại nén tốt) — phần lớn là do kéo lại cả 2.000 dòng mỗi lần bán, nên
// nay kéo delta theo watermark + tra tên lúc hiển thị từ catalog trong bộ nhớ.
// Test chỉ đọc file nên không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const shiftStock = read('lib/store/tx/shift-stock.tsx');
const inventory = read('components/inventory/InventoryView.tsx');
const migration = read('supabase/migrations/0056_stock_movements_created_index.sql');

describe('pull biến động kho: nhẹ payload + đúng tên sản phẩm', () => {
  it('không JOIN products(name) nữa (đo thật: 240 -> 217 KB, tên do view tra catalog)', () => {
    assert.doesNotMatch(shiftStock, /from\('stock_movements'\)[\s\S]{0,200}products\(name\)/);
  });

  it('chỉ lấy đúng các cột dùng, giữ đủ cho bảng + export + phân loại nghiệp vụ', () => {
    const m = shiftStock.match(/from\('stock_movements'\)[\s\S]{0,400}?\.select\('([^']+)'\)/);
    assert.ok(m, 'phải có select() tường minh cho stock_movements');
    const cols = m[1].split(',').map((s) => s.trim());
    assert.deepEqual(
      [...cols].sort(),
      // 0064: movement_type là cột THẬT trên server (trước đây phải đoán bằng regex note).
      ['created_at', 'id', 'movement_type', 'new_stock', 'note', 'previous_stock', 'product_id', 'quantity', 'reference_code']
    );
  });

  it('0064: ưu tiên movement_type thật, chỉ đoán bằng note cho dòng cũ (NULL)', () => {
    assert.match(shiftStock, /const byColumn = knownTypes\.has\(row\.movement_type\)/);
    assert.match(shiftStock, /byColumn \|\|/);
  });

  it('giữ nguyên trần số dòng và thứ tự DESC (UI vẫn thấy bản ghi mới nhất trước)', () => {
    assert.match(shiftStock, /STOCK_MOVEMENT_LIMIT = 2000/);
    assert.match(shiftStock, /order\('created_at', \{ ascending: false \}\)/);
    assert.match(shiftStock, /\.limit\(STOCK_MOVEMENT_LIMIT\)/);
  });

  it('sau lần kéo đầu thì chỉ kéo delta từ watermark (có chồng 2s chống trùng giây)', () => {
    assert.match(shiftStock, /const incremental = movementsLoadedRef\.current && !force && movementsWatermarkRef\.current;/);
    assert.match(shiftStock, /STOCK_MOVEMENT_OVERLAP_MS = 2000/);
    assert.match(shiftStock, /query = query\.gte\('created_at', from\);/);
  });

  it('kéo toàn bộ khi chưa có watermark, khi delta chạm trần, hoặc caller ép force', () => {
    assert.match(shiftStock, /const hitLimit = rows\.length >= STOCK_MOVEMENT_LIMIT;/);
    assert.match(shiftStock, /if \(newest && !hitLimit\) movementsWatermarkRef\.current = newest;/);
    // Đăng nhập / hydrate / làm mới tay -> force
    const store = read('lib/store.tsx');
    assert.equal((store.match(/refreshServerStockMovements\(true\)/g) || []).length, 2);
  });

  it('gộp delta theo id, dòng mới đè bản cũ, không nhân bản', () => {
    assert.match(shiftStock, /const merged = new Map\(prev\.map\(\(m\) => \[m\.id, m\]\)\);/);
    assert.match(shiftStock, /for \(const m of mapped\) merged\.set\(m\.id, m\);/);
    assert.match(shiftStock, /sort\(\(a, b\) => b\.created_at\.localeCompare\(a\.created_at\)\)/);
  });

  it('tên sản phẩm để trống lúc kéo, view tra từ catalog + fallback khi mục đã xoá', () => {
    assert.match(shiftStock, /product_name: '',/);
    assert.match(inventory, /nameById = new Map\(products\.map\(\(p\) => \[p\.id, p\.name\]\)\)/);
    assert.match(inventory, /product_name: nameById\.get\(m\.product_id\) \|\| m\.product_name \|\| 'Sản phẩm đã xóa'/);
  });

  it('mọi chỗ hiển thị/lọc/sắp xếp biến động đều dùng mảng đã tra tên', () => {
    // Lọc + sắp xếp + đếm đều phải xuất phát từ `movements` (đã tra tên), không phải
    // `stockMovements` thô — nếu không thì tên sản phẩm hiển thị rỗng sau khi bỏ JOIN.
    assert.match(inventory, /const filteredMovements = movements\.filter\(/);
    assert.match(inventory, /Nhật ký Thẻ kho \(\{movements\.length\}\)/);
    // `stockMovements` chỉ còn được đọc trong useMemo dựng `movements`.
    const uses = inventory.match(/stockMovements/g) || [];
    assert.ok(uses.length <= 6, 'số chỗ đọc stockMovements phải ít (chỉ trong memo): ' + uses.length);
  });

  it('có index created_at cho bảng này (không thì mỗi lần kéo đều sort cả bảng)', () => {
    assert.match(
      migration,
      /CREATE INDEX IF NOT EXISTS idx_stock_created ON public\.stock_movements \(created_at DESC\);/
    );
  });
});

describe('mở màn Dự án phải kéo lại dữ liệu', () => {
  const projectsView = read('components/projects/ProjectsView.tsx');
  const hrmView = read('components/hrm/HRMView.tsx');

  it('ProjectsView gọi syncProjects khi mở màn (và lại khi vào lại mạng)', () => {
    assert.match(projectsView, /useEffect\(\(\) => \{\s*if \(!isOnline\) return;\s*syncProjects\(\);/);
  });

  it('syncProjects có sẵn trong store nhưng trước đây không view nào gọi', () => {
    assert.match(read('lib/store.tsx'), /syncProjects: \(\) => Promise<void>;/);
    // HRMView làm mẫu: refreshHrm() khi mở màn
    assert.match(hrmView, /useEffect\(\(\) => \{\s*refreshHrm\(\);/);
  });
});
