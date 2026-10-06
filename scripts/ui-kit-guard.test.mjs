// Guard hệ thống UI dùng chung (components/ui): header, badge, nút, lọc,
// trạng thái rỗng, tab — cấm hardcode chuỗi class lẻ ngoài kit để khỏi lệch
// chuẩn giữa các trang (bệnh cũ: px-3 vs px-3.5, badge 5 biến thể, ngưỡng 15).
//
// Phạm vi: 8 trang quản lý (đơn, khách, NCC, hàng hóa, kho, sổ quỹ, dự án,
// báo cáo). POS/HRM/Cài đặt bespoke — ngoài phạm vi đợt này.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const VIEWS = [
  'components/orders/OrdersView.tsx',
  'components/customers/CustomersView.tsx',
  'components/suppliers/SuppliersView.tsx',
  'components/products/ProductsView.tsx',
  'components/inventory/InventoryView.tsx',
  'components/cashbook/CashbookView.tsx',
  'components/projects/ProjectsView.tsx',
  'components/reports/ReportsView.tsx',
];
// Header NCC bespoke (subtitle riêng) — còn lại đều dùng PageHeader.
const HEADER_VIEWS = VIEWS.filter((f) => f !== 'components/suppliers/SuppliersView.tsx');

describe('ui kit: file + export đầy đủ', () => {
  it('đủ 6 module kit', () => {
    for (const f of [
      'components/ui/PageHeader.tsx',
      'components/ui/StatusBadge.tsx',
      'components/ui/FilterControls.tsx',
      'components/ui/ListStates.tsx',
      'components/ui/AppButton.tsx',
      'components/ui/TabSwitcher.tsx',
    ]) {
      assert.ok(existsSync(join(ROOT, f)), `thiếu ${f}`);
    }
  });

  it('StatusBadge đủ 6 tone + 2 dạng (pill/tag) + 2 độ đậm', () => {
    const src = read('components/ui/StatusBadge.tsx');
    for (const tone of ['emerald', 'amber', 'rose', 'purple', 'blue', 'slate']) {
      assert.match(src, new RegExp(`${tone}: 'bg-${tone}-100 text-${tone}-(800|600)'`));
    }
    assert.match(src, /pill = true/);
    assert.match(src, /weight = 'bold'/);
  });

  it('AppButton đủ tone xanh/hổ phách/ngọc/đỏ + khóa disabled mờ', () => {
    const src = read('components/ui/AppButton.tsx');
    for (const tone of ['blue', 'amber', 'emerald', 'rose']) {
      assert.match(src, new RegExp(`${tone}: 'bg-${tone}-600`));
    }
    assert.match(src, /disabled:opacity-50/);
  });
});

describe('ui kit: các trang dùng chung, cấm class lẻ', () => {
  it('header chuẩn PageHeader (trừ NCC bespoke)', () => {
    for (const f of HEADER_VIEWS) {
      assert.match(read(f), /<PageHeader/, `${f} phải dùng PageHeader`);
    }
    const noRawHeader = VIEWS.filter((f) => f !== 'components/suppliers/SuppliersView.tsx');
    for (const f of noRawHeader) {
      assert.ok(
        !/h-14 px-(2 sm:px-4|4) bg-white border-b border-slate-200 flex items-center justify-between/.test(read(f)),
        `${f} còn header hardcode`
      );
    }
  });

  it('badge chuẩn StatusBadge, cấm chuỗi màu lẻ', () => {
    for (const f of VIEWS) {
      const src = read(f);
      if (/StatusBadge/.test(src)) assert.match(src, /<StatusBadge/, `${f} import mà không dùng`);
    }
    const badgeUsers = [
      'components/orders/OrdersView.tsx',
      'components/customers/CustomersView.tsx',
      'components/products/ProductsView.tsx',
      'components/inventory/InventoryView.tsx',
      'components/cashbook/CashbookView.tsx',
    ];
    for (const f of badgeUsers) {
      const src = read(f);
      assert.ok(!/bg-(emerald|amber|rose|purple|blue)-100 text-\1-800 rounded-full text-\[10px\] font-bold/.test(src), `${f} còn badge hardcode`);
      assert.ok(!/bg-(amber|emerald)-100 text-\1-800['"`}]/.test(src) || /TONE/.test(src), `${f} còn tag màu hardcode`);
    }
  });

  it('nút chính/phụ chuẩn AppButton, cấm class nút lẻ', () => {
    const btnUsers = [
      'components/orders/OrdersView.tsx',
      'components/customers/CustomersView.tsx',
      'components/suppliers/SuppliersView.tsx',
      'components/products/ProductsView.tsx',
      'components/inventory/InventoryView.tsx',
      'components/cashbook/CashbookView.tsx',
      'components/projects/ProjectsView.tsx',
    ];
    for (const f of btnUsers) {
      assert.match(read(f), /<AppButton/, `${f} phải dùng AppButton`);
    }
    for (const f of VIEWS) {
      assert.ok(
        !/bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold|bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold|bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold|bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold/.test(
          read(f)
        ),
        `${f} còn nút màu hardcode`
      );
    }
  });

  it('lọc chuẩn SearchInput/FilterSelect, cấm ô/select lẻ', () => {
    const filterUsers = [
      'components/orders/OrdersView.tsx',
      'components/customers/CustomersView.tsx',
      'components/suppliers/SuppliersView.tsx',
      'components/products/ProductsView.tsx',
      'components/inventory/InventoryView.tsx',
      'components/cashbook/CashbookView.tsx',
    ];
    for (const f of filterUsers) {
      const src = read(f);
      assert.match(src, /<SearchInput/, `${f} phải dùng SearchInput`);
      assert.match(src, /<FilterSelect/, `${f} phải dùng FilterSelect`);
      assert.ok(!/w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md/.test(src), `${f} còn ô tìm hardcode`);
    }
  });

  it('trạng thái rỗng chuẩn TableEmpty/ListEmpty', () => {
    const emptyUsers = [
      'components/orders/OrdersView.tsx',
      'components/customers/CustomersView.tsx',
      'components/suppliers/SuppliersView.tsx',
      'components/products/ProductsView.tsx',
      'components/inventory/InventoryView.tsx',
      'components/cashbook/CashbookView.tsx',
      'components/reports/ReportsView.tsx',
    ];
    for (const f of emptyUsers) {
      const src = read(f);
      assert.match(src, /<TableEmpty colSpan=/, `${f} phải dùng TableEmpty`);
      assert.ok(!/py-12 text-center text-slate-400/.test(src), `${f} còn ô trống hardcode`);
    }
  });

  it('tab Kho/Báo cáo chuẩn TabSwitcher', () => {
    const inv = read('components/inventory/InventoryView.tsx');
    assert.match(inv, /<TabSwitcher<'stocks' \| 'movements' \| 'adjustments'>/);
    assert.match(inv, /id: 'btn-inventory-tab-adjustments'/, 'giữ id cho e2e');
    const rep = read('components/reports/ReportsView.tsx');
    assert.match(rep, /<TabSwitcher<ReportTab>/);
    assert.ok(!/px-3 py-1 text-xs font-semibold rounded-md transition-all/.test(inv + rep), 'còn tab hardcode');
  });

  it('thẻ kho gộp theo phiếu (mặc định), bấm mở rộng xem dòng', () => {
    const inv = read('components/inventory/InventoryView.tsx');
    assert.match(inv, /useState<'voucher' \| 'lines'>\('voucher'\)/);
    assert.match(inv, /paginatedVouchers/);
    assert.match(inv, /toggleVoucher/);
    assert.match(inv, /Theo phiếu/);
    assert.match(inv, /Theo dòng/);
  });
});
