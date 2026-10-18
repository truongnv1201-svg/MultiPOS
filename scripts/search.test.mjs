// Tìm kiếm dùng chung (lib/search.ts) — bỏ dấu tiếng Việt + token AND cho các bảng.
//
// Vì sao có: trước đây mỗi màn tự `toLowerCase().includes()` nên gõ nhanh không dấu
// ("kinh cuong luc", "nguyen van a") trượt dòng cần tìm, và gõ nhiều từ rời cũng trượt
// nếu có chữ chen giữa. Riêng POS có thêm xếp hạng liên quan ở lib/product-search.ts
// (rankProducts) — test cho phần đó nằm ở scripts/product-search.test.mjs.
//
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fold, tokenize, matchesQuery } from '../lib/search.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('fold: bỏ dấu + đ/Đ + thường hoá', () => {
  it('bỏ dấu nguyên âm/thanh', () => {
    assert.equal(fold('Kính cường lực'), 'kinh cuong luc');
    assert.equal(fold('Nhôm Xingfa'), 'nhom xingfa');
    assert.equal(fold('Nguyễn Văn Ánh'), 'nguyen van anh');
  });

  it('đ/Đ (U+0111) không bị NFD tách -> map tay', () => {
    assert.equal(fold('Đường'), 'duong');
    assert.equal(fold('đường ống'), 'duong ong');
  });

  it('giữ nguyên số và ký tự mã', () => {
    assert.equal(fold('SP000001'), 'sp000001');
    assert.equal(fold('ABC123'), 'abc123');
  });

  it('rỗng/null an toàn', () => {
    assert.equal(fold(''), '');
    assert.equal(fold(null), '');
    assert.equal(fold(undefined), '');
  });
});

describe('tokenize + matchesQuery', () => {
  it('query rỗng = khớp tất (chưa gõ gì thì không lọc)', () => {
    assert.deepEqual(tokenize('  '), []);
    assert.equal(matchesQuery(['abc'], ''), true);
    assert.equal(matchesQuery(['abc'], '   '), true);
  });

  it('AND giữa các token, OR giữa các trường', () => {
    assert.equal(matchesQuery(['Kính cường lực 10mm'], 'kinh 10mm'), true);
    assert.equal(matchesQuery(['Kính cường lực 10mm'], 'kinh 12mm'), false);
  });

  it('khớp xuyên trường (tên + mã)', () => {
    assert.equal(matchesQuery(['Kính cường lực', 'SP000001'], 'sp000001'), true);
    assert.equal(matchesQuery(['Nguyễn Văn A', '0901234567'], 'nguyen 0901'), true);
  });

  it('gõ không dấu vẫn ra (lỗi cũ: trượt hoàn toàn)', () => {
    assert.equal(matchesQuery(['Keo Silicone Apollo'], 'keo silicone apollo'), true);
    assert.equal(matchesQuery(['Công trình Nhà máy ABC'], 'cong trinh nha may'), true);
  });

  it('trường null/undefined bỏ qua, không ném lỗi', () => {
    assert.equal(matchesQuery([null, undefined, 'Đường ống PVC'], 'duong ong'), true);
  });
});

describe('wiring UI: mọi ô tìm dùng helper dùng chung, cấm includes() thô', () => {
  const FILES = [
    'components/pos/ProductSearchBar.tsx',
    'components/pos/POSScreen.tsx',
    'components/pos/MobilePaymentSheet.tsx',
    'components/products/ProductsView.tsx',
    'components/inventory/StockAdjustModal.tsx',
    'components/inventory/StockAdjustTable.tsx',
    'components/inventory/InventoryView.tsx',
    'components/common/SearchableSelect.tsx',
    'components/customers/CustomersView.tsx',
    'components/suppliers/SuppliersView.tsx',
    'components/orders/OrdersView.tsx',
    'components/cashbook/CashbookView.tsx',
    'components/imports/ImportsView.tsx',
    'components/projects/ProjectsView.tsx',
    'components/vouchers/ExportsTab.tsx',
    'components/reports/ReportsView.tsx',
    'components/hrm/tabs/AttendanceTab.tsx',
    'components/hrm/tabs/StaffTab.tsx',
  ];

  it('đều import từ @/lib/search', () => {
    for (const f of FILES) {
      assert.match(read(f), /from '@\/lib\/search'/, `${f} phải dùng helper tìm kiếm chung`);
    }
  });

  it('không còn so khớp includes() thô của người dùng (mất dấu)', () => {
    for (const f of FILES) {
      assert.ok(
        !/\.toLowerCase\(\)\.includes\(/.test(read(f)),
        `${f} còn pattern .toLowerCase().includes() — phải dùng fold/matchesQuery`
      );
    }
  });

  it('foldAccents của POS bỏ dấu + đ/Đ (khớp fold của helper chung)', () => {
    const ps = read('lib/product-search.ts');
    assert.match(ps, /replace\(\/đ\/g, 'd'\)/);
    // Cùng công thức với lib/search.ts — có test chéo ở scripts/product-search.test.mjs.
    assert.match(read('lib/search.ts'), /replace\(\/đ\/g, 'd'\)/);
  });
});

describe('wiring POS: xếp hạng + báo còn kết quả + quét mã bỏ dấu', () => {
  const pos = read('components/pos/ProductSearchBar.tsx');

  it('xếp hạng TRƯỚC khi cắt top 8, và đếm phần dư', () => {
    assert.match(pos, /rankProducts\(/);
    assert.match(pos, /\.slice\(0, 8\)/);
    assert.match(pos, /moreCount/);
    assert.match(pos, /kết quả khác/);
  });

  it('ẩn hàng ngừng bán trước khi xếp hạng', () => {
    assert.match(pos, /products\.filter\(\(p\) => p\.is_active !== false\)/);
  });

  it('quét mã dùng fold cho cả 2 phía (nhất quán với ô tìm)', () => {
    assert.match(pos, /fold\(p\.barcode\) === normalized/);
    assert.match(pos, /fold\(p\.sku\) === normalized/);
  });
});
