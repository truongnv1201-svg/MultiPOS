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
import { fold, tokenize, matchesQuery, rankContacts } from '../lib/search.ts';

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

const C = (name, phone, code) => ({ name, phone, code });

describe('rankContacts: xếp hạng khách/NCC cho ô chọn ở POS', () => {
  const list = [
    C('Nguyễn Văn An', '0901234567', 'KH0001'),
    C('Trần Bình', '0912345678', 'KH0002'),
    C('Công ty Nhôm Kính An Phát', '0283456789', 'KH0003'),
  ];

  it('SĐT/mã khớp tuyệt đối lên đầu, gõ liền vẫn khớp khi lưu có khoảng trắng', () => {
    assert.equal(rankContacts(list, 'KH0002')[0].name, 'Trần Bình');
    assert.equal(rankContacts(list, '0901234567')[0].name, 'Nguyễn Văn An');
    const spaced = [C('A', '0901 234 567', 'KH0001'), C('B', '0909999999', 'KH0002')];
    assert.equal(rankContacts(spaced, '0901234567')[0].name, 'A');
  });

  it('gõ không dấu vẫn ra, AND giữa các từ', () => {
    assert.equal(rankContacts(list, 'nguyen an')[0].name, 'Nguyễn Văn An');
    assert.equal(rankContacts(list, 'an 0283')[0].name, 'Công ty Nhôm Kính An Phát');
    assert.deepEqual(rankContacts(list, 'nguyen 0912'), []);
  });

  it('query rỗng trả limit dòng đầu (không render cả danh sách)', () => {
    assert.equal(rankContacts(list, '').length, 3);
    assert.equal(rankContacts(list, '   ', 2).length, 2);
  });

  it('cắt top N sau khi xếp hạng', () => {
    assert.equal(rankContacts(list, 'a', 1).length, 1);
  });

  it('đồng điểm xếp theo tên A→Z, không phụ thuộc thứ tự mảng', () => {
    const same = [C('Bình', '090', 'KH2'), C('An', '090', 'KH1')];
    assert.deepEqual(rankContacts(same, '090').map((c) => c.name), ['An', 'Bình']);
    assert.deepEqual(rankContacts([...same].reverse(), '090').map((c) => c.name), ['An', 'Bình']);
  });

  it('từ 1 ký tự không so SĐT/mã (tránh khớp mọi dòng)', () => {
    assert.deepEqual(rankContacts(list, '0'), []);
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

  it('foldAccents của POS dùng chung fold() của lib/search (một công thức bỏ dấu)', () => {
    const ps = read('lib/product-search.ts');
    // Import đuôi .ts để Node test chạy trực tiếp (tsconfig bật allowImportingTsExtensions).
    assert.match(ps, /import \{ fold \} from '\.\/search\.ts'/);
    assert.match(ps, /export const foldAccents = fold/);
    assert.match(read('lib/search.ts'), /replace\(\/đ\/g, 'd'\)/);
  });

  it('ô khách POS / sheet mobile dùng rankContacts và cắt top 20', () => {
    assert.match(read('components/pos/POSScreen.tsx'), /rankContacts\(customerOptions, customerSearch, 20\)/);
    assert.match(read('components/pos/MobilePaymentSheet.tsx'), /rankContacts\(customers, customerQuery, 20\)/);
  });

  it('SearchableSelect cắt 100 lựa chọn ngay trong filtered (phím không đi quá dòng đang thấy)', () => {
    const src = read('components/common/SearchableSelect.tsx');
    assert.match(src, /MAX_VISIBLE_OPTIONS/);
    assert.ok(!/filtered\.slice\(0, 100\)/.test(src), 'phải cắt trong filtered, không cắt lúc render');
  });
});

describe('wiring POS: xếp hạng + báo còn kết quả + quét mã bỏ dấu', () => {
  const pos = read('components/pos/ProductSearchBar.tsx');

  it('xếp hạng TRƯỚC khi cắt top 30, và đếm phần dư', () => {
    assert.match(pos, /rankProductIndex\(/);
    assert.match(pos, /\.slice\(0, 30\)/);
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
