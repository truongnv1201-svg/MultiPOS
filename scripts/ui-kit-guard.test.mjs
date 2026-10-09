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
  'components/imports/ImportsView.tsx',
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
      'components/imports/ImportsView.tsx',
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
      'components/imports/ImportsView.tsx',
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

  it('FilterSelect tự vẽ (popup hệ điều hành không style được): nút + listbox + portal', () => {
    const src = read('components/ui/FilterControls.tsx');
    assert.match(src, /aria-haspopup="listbox"/);
    assert.match(src, /role="listbox"/);
    assert.match(src, /role="option"/);
    assert.match(src, /createPortal\(/);
    assert.match(src, /<ChevronDown/);
    assert.match(src, /<Check/);
    assert.ok(!/^\s*<select[\s>]/m.test(src), 'FilterControls không còn thẻ select gốc');
    // DateFilter + PaginationBar dùng chung FilterSelect (không select lẻ)
    assert.match(read('components/common/DateFilter.tsx'), /<FilterSelect/);
    assert.ok(!/^\s*<select[\s>]/m.test(read('components/common/DateFilter.tsx')), 'DateFilter không còn thẻ select gốc');
    assert.match(read('components/common/PaginationBar.tsx'), /<FilterSelect/);
    assert.ok(!/^\s*<select[\s>]/m.test(read('components/common/PaginationBar.tsx')), 'PaginationBar không còn thẻ select gốc');
  });

  it('trạng thái rỗng chuẩn TableEmpty/ListEmpty', () => {
    const emptyUsers = [
      'components/orders/OrdersView.tsx',
      'components/imports/ImportsView.tsx',
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

  it('tab Chứng từ + Hàng hóa chuẩn TabSwitcher (Kho thuần thẻ kho, không tab lồng)', () => {
    const vouchers = read('components/vouchers/VouchersView.tsx');
    assert.match(vouchers, /<TabSwitcher<VoucherTab>/);
    assert.match(vouchers, /id: 'vouchers-tab-sales'/);
    assert.match(vouchers, /id: 'vouchers-tab-imports'/);
    assert.match(vouchers, /id: 'vouchers-tab-exports'/);
    assert.match(vouchers, /id: 'vouchers-tab-adjust'/);
    const goods = read('components/goods/GoodsView.tsx');
    assert.match(goods, /<TabSwitcher<GoodsTab>/);
    assert.match(goods, /id: 'goods-tab-catalog'/);
    assert.match(goods, /id: 'goods-tab-movements'/);
    const inv = read('components/inventory/InventoryView.tsx');
    assert.ok(!/<TabSwitcher/.test(inv), 'Kho không còn tab lồng (điều chỉnh đã sang Chứng từ)');
    const rep = read('components/reports/ReportsView.tsx');
    assert.match(rep, /<TabSwitcher<ReportTab>/);
    assert.ok(!/px-3 py-1 text-xs font-semibold rounded-md transition-all/.test(vouchers + goods + rep), 'còn tab hardcode');
  });

  it('trang tab chỉ có 1 header (shell giữ PageHeader, inner ẩn khi bare)', () => {
    const goods = read('components/goods/GoodsView.tsx');
    assert.equal((goods.match(/<PageHeader/g) || []).length, 1, 'GoodsView đúng 1 PageHeader');
    const vouchers = read('components/vouchers/VouchersView.tsx');
    assert.equal((vouchers.match(/<PageHeader/g) || []).length, 1, 'VouchersView đúng 1 PageHeader');
    for (const f of [
      'components/products/ProductsView.tsx',
      'components/inventory/InventoryView.tsx',
      'components/orders/OrdersView.tsx',
      'components/imports/ImportsView.tsx',
    ]) {
      const src = read(f);
      assert.match(src, /\{!bare && \(\s*<PageHeader/, `${f} ẩn header khi bare`);
      assert.match(src, /\{bare && \(?\s*<TableTools/, `${f} đưa TableTools xuống filter khi bare`);
    }
  });

  it('tab Danh muc co nut Dieu chinh ton mo modal chung cua shell', () => {
    const goods = read('components/goods/GoodsView.tsx');
    assert.match(goods, /<span>Điều chỉnh tồn<\/span>/);
    assert.match(goods, /<StockAdjustModal open=\{adjustOpen} onClose=\{\(\) => setAdjustOpen\(false\)\} \/>/);
    // Modal trong InventoryView chỉ tự mount khi đứng độc lập (tránh 2 instance chồng nhau)
    assert.match(
      read('components/inventory/InventoryView.tsx'),
      /\{onAdjustOpenChange === undefined && \(\s*<StockAdjustModal/
    );
  });

  it('vỏ tab không lồng padding với view con (lề đơn p-4 chuẩn bảng chung)', () => {
    // View con đã tự có p-4 (Orders/Imports/Products/Inventory) hoặc là thẻ card
    // cần bọc p-4 (ExportsTab/StockAdjustTable) — vỏ chỉ bọc, không thêm lề chung.
    for (const f of ['components/vouchers/VouchersView.tsx', 'components/goods/GoodsView.tsx']) {
      const src = read(f);
      assert.match(src, /<div className="flex-1 min-h-0 flex flex-col overflow-hidden">/, `${f} content không p-4`);
    }
    assert.match(
      read('components/vouchers/VouchersView.tsx'),
      /<div className="flex-1 min-h-0 overflow-hidden p-4 flex flex-col">\s*<ExportsTab/,
      'tab thẻ card được bọc p-4 một lớp'
    );
  });

  it('nút tạo trên header shell cùng min-width theo trang (đổi tab không nhảy nút)', () => {
    // Mỗi shell 1 min-w ôm nút dài nhất của nó + căn giữa chữ.
    for (const f of [
      'components/vouchers/VouchersView.tsx',
      'components/goods/GoodsView.tsx',
      'components/debts/DebtsView.tsx',
    ]) {
      const src = read(f);
      const buttons = src.match(/<AppButton[^>]*className="min-w-\d+ justify-center"/g) || [];
      assert.ok(buttons.length > 0, `${f} nút tạo phải có min-w + justify-center`);
      const widths = new Set((src.match(/min-w-\d+/g) || []));
      assert.equal(widths.size, 1, `${f} chung 1 min-width cho mọi nút tạo, không mỗi nút một cỡ`);
    }
  });

  it('thẻ kho chỉ hiện từng dòng (đã bỏ gộp theo phiếu)', () => {
    const inv = read('components/inventory/InventoryView.tsx');
    assert.ok(!/useState<'voucher' \| 'lines'>/.test(inv), 'còn state gộp phiếu');
    assert.ok(!/paginatedVouchers|toggleVoucher|Theo phiếu|Theo dòng/.test(inv), 'còn UI gộp phiếu');
    assert.match(inv, /paginatedMovements/);
  });
});
