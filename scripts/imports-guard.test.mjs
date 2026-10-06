// Guard trang Quản lý Đơn nhập (imports) — mirror trang đơn bán:
// màn hình đăng ký đủ (type/menu/phím tắt/page), store expose purchaseOrders,
// view dùng kit dùng chung + chi tiết suy từ danh sách đã lọc.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('don nhap: man hinh dang ky du', () => {
  it('ActiveScreen + page + menu + phim tat Alt+D', () => {
    assert.ok(existsSync(join(ROOT, 'components/imports/ImportsView.tsx')));
    assert.match(read('lib/types.ts'), /\| 'imports'/);
    assert.match(read('app/page.tsx'), /{effectiveScreen === 'imports' && <ImportsView \/>}/);
    const menu = read('components/FlyoutMenu.tsx');
    assert.match(menu, /screen: 'imports' as const, label: 'Quản lý Đơn nhập'/);
    assert.match(menu, /shortcut: 'Alt \+ D'/);
    const header = read('components/GlobalHeader.tsx');
    assert.match(header, /\/\/ Alt \+ D: Imports/);
    assert.match(header, /go\('imports'\)/);
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
