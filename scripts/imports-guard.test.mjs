// Guard trang Quản lý Chứng từ (vouchers) — Đơn nhập sống ở tab Đơn nhập:
// màn hình đăng ký đủ (type/page/menu/phím tắt), store expose purchaseOrders,
// view dùng kit dùng chung + chi tiết suy từ danh sách đã lọc.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('chung tu: man hinh dang ky du', () => {
  it('ActiveScreen + page + menu + phim tat (Alt+H/D mo dung tab)', () => {
    assert.ok(existsSync(join(ROOT, 'components/vouchers/VouchersView.tsx')));
    assert.ok(existsSync(join(ROOT, 'components/vouchers/ExportsTab.tsx')));
    assert.ok(existsSync(join(ROOT, 'components/goods/GoodsView.tsx')));
    const types = read('lib/types.ts');
    assert.match(types, /\| 'vouchers'/);
    assert.match(types, /\| 'goods'/);
    const page = read('app/page.tsx');
    assert.match(page, /{effectiveScreen === 'vouchers' && <VouchersView \/>}/);
    assert.match(page, /{effectiveScreen === 'orders' && <VouchersView initialTab="sales" \/>}/);
    assert.match(page, /{effectiveScreen === 'imports' && <VouchersView initialTab="imports" \/>}/);
    assert.match(page, /{effectiveScreen === 'goods' && <GoodsView \/>}/);
    assert.match(page, /{effectiveScreen === 'products' && <GoodsView initialTab="catalog" \/>}/);
    assert.match(page, /{effectiveScreen === 'inventory' && <GoodsView initialTab="movements" \/>}/);
    const menu = read('components/FlyoutMenu.tsx');
    assert.match(menu, /screen: 'vouchers', label: 'Quản lý Chứng từ'/);
    assert.match(menu, /screen: 'goods' as const, label: 'Quản lý Hàng hóa'/);
    assert.ok(!/screen: 'imports'/.test(menu), 'menu không còn mục Đơn nhập riêng');
    assert.ok(!/screen: 'orders'/.test(menu), 'menu không còn mục Hóa đơn riêng');
    const header = read('components/GlobalHeader.tsx');
    assert.match(header, /go\('imports'\)/);
    assert.match(header, /go\('orders'\)/);
  });

  it('tab Dieu chinh tu refresh server khi mo (nhu tab Kho cu)', () => {
    const shell = read('components/vouchers/VouchersView.tsx');
    assert.match(shell, /refreshServerStockAdjustments/);
    assert.match(shell, /if \(activeTab === 'adjust'\) void refreshServerStockAdjustments\(true\)/);
  });
});

describe('don nhap: store expose purchaseOrders', () => {
  it('shift-stock -> transactions -> store + nap boot', () => {
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /purchaseOrders: PurchaseOrder\[\];/);
    assert.match(shift, /refreshPurchaseOrders: \(\) => Promise<boolean>;/);
    assert.match(shift, /setPurchaseOrders\(\(prev\) => \[poRecord, \.\.\.prev\]\)/);
    const tx = read('lib/store/transactions.tsx');
    assert.match(tx, /purchaseOrders: shiftStock\.purchaseOrders,/);
    assert.match(tx, /refreshPurchaseOrders: shiftStock\.refreshPurchaseOrders,/);
    const store = read('lib/store.tsx');
    assert.match(store, /purchaseOrders: PurchaseOrder\[\];/);
    assert.match(store, /refreshPurchaseOrders\(\);/);
    assert.match(store, /refreshServerPurchaseOrders: \(\) => Promise<boolean>;/);
    assert.match(store, /purchase_orders: \[refreshCatalog, refreshServerCashbook, refreshServerPurchaseOrders\]/);
  });

  it('server lưu dòng hàng phiếu nhập (0075) để pull liên máy đủ chi tiết', () => {
    const sql = read('supabase/migrations/0075_import_lines.sql');
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0075_import_lines.sql')));
    assert.match(sql, /add column if not exists lines jsonb not null default '\[\]'/);
    assert.match(sql, /status, client_ref, note, lines\)/);
    assert.match(sql, /p_client_ref, v_note, p_lines\)/);
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /refreshServerPurchaseOrders = useCallback/);
    assert.match(shift, /from\('purchase_orders'\)/);
  });
});

describe('don nhap: view dung kit + chi tiet tu danh sach loc', () => {
  const view = read('components/imports/ImportsView.tsx');

  it('PageHeader + StatusBadge + AppButton + loc + rong + phan trang', () => {
    assert.match(view, /id="imports-view"/);
    assert.match(view, /<PageHeader/);
    assert.match(view, /<StatusBadge/);
    assert.match(view, /<AppButton/);
    assert.match(view, /<SearchInput/);
    assert.match(view, /<FilterSelect/);
    assert.match(view, /<TableEmpty colSpan=/);
    assert.match(view, /<PaginationBar/);
    assert.match(view, /<DateFilter/);
    assert.match(view, /<TableTools/);
    assert.match(view, /useSortState\('created_at', 'desc'\)/);
  });

  it('selectedPo suy tu filteredPos, null stays null, co placeholder', () => {
    assert.ok(!/purchaseOrders\.find\(\(p\) => p\.id === selectedPoId/.test(view), 'cấm tìm trong purchaseOrders thô');
    assert.match(view, /filteredPos\.find\(\(p\) => p\.id === selectedPoId\)/);
    assert.match(view, /filteredPos\.find\(\(p\) => p\.code === selectedPoCode\)/);
    assert.match(view, /if \(!selectedPoId && !selectedPoCode\) return null;/);
    assert.match(view, /Chọn phiếu nhập để xem chi tiết/);
  });
});
