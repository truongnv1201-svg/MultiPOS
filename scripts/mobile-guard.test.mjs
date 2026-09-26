// Test tĩnh bảo vệ Giai đoạn 2 (mobile-first): các bảng ngang phải có record list
// / bottom sheet thay thế trên điện thoại, và Sync Center phải mở được từ header.
// Chạy: npm test (node --test ...). Chỉ đọc file nên không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('POS: mobile cart sheet thay bảng ngang', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const sheet = read('components/pos/MobileCartSheet.tsx');

  it('bảng giỏ bán chỉ hiện từ lg trở lên', () => {
    assert.match(pos, /hidden lg:block border border-slate-200 rounded-lg overflow-hidden shadow-2xs/);
  });

  it('bảng dòng nhập chỉ hiện từ lg trở lên', () => {
    assert.match(pos, /lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100/);
  });

  it('nút Giỏ trên dock mở sheet thay vì cuộn tới bảng', () => {
    assert.match(pos, /onOpenCart=\{\(\) => \{[\s\S]{0,400}setIsMobileCartOpen\(true\)/);
  });

  it('sheet có id ổn định + nút đóng + thanh toán, có safe-area', () => {
    assert.match(sheet, /id="cart-record-list"/);
    assert.match(sheet, /aria-label="Đóng giỏ hàng"/);
    assert.match(sheet, /onCheckout/);
    assert.match(sheet, /pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it('sheet dùng lại callback giỏ sẵn có (không nhân bản logic giỏ)', () => {
    assert.match(pos, /onQuantityChange=\{\(itemId, quantity\) => updateCartItem\(itemId, \{ quantity \}\)\}/);
    assert.match(pos, /onRemove=\{removeCartItem\}/);
  });
});

describe('Kho + NCC: mobile record list', () => {
  const inv = read('components/inventory/InventoryView.tsx');
  const sup = read('components/suppliers/SuppliersView.tsx');

  it('kho có record list tồn và thẻ kho, bảng ẩn trên mobile', () => {
    assert.match(inv, /id="stock-record-list" className="lg:hidden/);
    assert.match(inv, /id="movement-record-list" className="lg:hidden/);
    assert.match(inv, /hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto/);
  });

  it('kho không bị bottom nav cắt (bỏ chiều cao 100dvh cứng)', () => {
    assert.match(inv, /id="inventory-view" className="[^"]*h-full[^"]*min-h-0/);
    assert.doesNotMatch(inv, /100dvh/);
  });

  it('NCC có record list + sheet chi tiết, bảng ẩn trên mobile', () => {
    assert.match(sup, /id="supplier-record-list" className="lg:hidden/);
    assert.match(sup, /aria-label="Chi tiết nhà cung cấp"/);
    assert.match(sup, /hidden md:flex w-full md:w-96/);
  });
});

describe('Sync Center: mở được từ header, xem & gửi lại hàng đợi', () => {
  const header = read('components/GlobalHeader.tsx');
  const sheet = read('components/common/SyncCenterSheet.tsx');

  it('header có nút mở trung tâm đồng bộ (id ổn định)', () => {
    assert.match(header, /id="header-sync-center-btn"/);
    assert.match(header, /<SyncCenterSheet open=\{syncCenterOpen\}/);
  });

  it('sheet đọc cả 3 hàng đợi offline và đếm thao tác lỗi', () => {
    assert.match(sheet, /db\.pendingOps\.toArray\(\)/);
    assert.match(sheet, /db\.pendingMasterData\.toArray\(\)/);
    assert.match(sheet, /db\.pendingOrders\.toArray\(\)/);
    assert.match(sheet, /status === 'failed'/);
  });

  it('sheet có hành động đồng bộ ngay, gửi lại lỗi và bỏ hàng đợi (có xác nhận)', () => {
    assert.match(sheet, /await refreshNow\(\)/);
    assert.match(sheet, /await syncPendingOps\(true\)/);
    assert.match(sheet, /confirmDialog\(/);
    assert.match(sheet, /db\.pendingOps\.clear\(\)/);
  });

  it('nút Làm mới rời đã bỏ — thao tác kéo số liệu gộp vào Trung tâm đồng bộ', () => {
    assert.doesNotMatch(header, /id="header-refresh-btn"/);
    assert.match(header, /id="header-sync-center-btn"[\s\S]{0,900}?Đang đồng bộ dữ liệu mới nhất/);
    assert.match(sheet, /await refreshNow\(\)/);
  });
});

describe('Giai đoạn 3: thanh toán ghim + sheet dùng chung + quét mã + PWA', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const pay = read('components/pos/MobilePaymentSheet.tsx');
  const shell = read('components/common/SheetShell.tsx');
  const scanner = read('components/pos/BarcodeScannerSheet.tsx');
  const search = read('components/pos/ProductSearchBar.tsx');
  const sup = read('components/suppliers/SuppliersView.tsx');
  const cus = read('components/customers/CustomersView.tsx');
  const pro = read('components/products/ProductsView.tsx');
  const addPro = read('components/products/AddProductFormModal.tsx');
  const store = read('lib/store.tsx');
  const sw = read('public/sw.js');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const offlineCard = read('components/settings/OfflineReadyCard.tsx');

  it('panel thanh toán desktop ẩn trên mobile, thay bằng thanh ghim + sheet', () => {
    assert.match(pos, /id="pos-payment-panel"[\s\S]{0,80}?className="hidden lg:flex/);
    assert.match(pos, /id="btn-pos-mobile-payment"/);
    assert.match(pos, /<MobilePaymentSheet/);
    assert.match(pos, /onPrimaryAction=\{isImportFlow \? handleImportCommit : \(\) => setIsMobilePaymentOpen\(true\)\}/);
  });

  it('sheet thanh toán có đủ phương thức, tiền khách đưa và nút thu tiền', () => {
    assert.match(pay, /aria-label="Thanh toán"/);
    assert.match(pay, /Tiền mặt/);
    assert.match(pay, /VietQR/);
    assert.match(pay, /Quẹt thẻ/);
    assert.match(pay, /Ghi nợ/);
    assert.match(pay, /id="mobile-payment-tendered-input"/);
    assert.match(pay, /id="btn-pos-mobile-payment-confirm"/);
    assert.match(pay, /pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it('SheetShell là bottom sheet trên mobile, hộp thoại trên desktop', () => {
    assert.match(shell, /fixed inset-0 z-50 flex items-end sm:items-center/);
    assert.match(shell, /sm:rounded-xl rounded-t-2xl/);
    assert.match(shell, /max-h-\[92dvh\]/);
  });

  it('modal danh mục + trả nợ dùng chung SheetShell (không còn overlay copy-paste)', () => {
    assert.match(sup, /<SheetShell/);
    assert.match(sup, /label="Phiếu chi trả nợ nhà cung cấp"/);
    assert.doesNotMatch(sup, /fixed inset-0 z-50 bg-slate-900\/50 flex items-center justify-center/);
    assert.match(cus, /<SheetShell/);
    assert.doesNotMatch(cus, /fixed inset-0 z-50 bg-slate-900\/60 backdrop-blur-xs/);
    assert.match(pro, /<SheetShell/);
    assert.match(addPro, /<SheetShell/);
  });

  it('quét mã vạch: BarcodeDetector + fallback nhập tay, camera được tắt khi đóng', () => {
    assert.match(scanner, /getUserMedia/);
    assert.match(scanner, /BarcodeDetector/);
    assert.match(scanner, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
    assert.match(scanner, /id="barcode-manual-input"/);
    assert.match(search, /id="btn-pos-scan-barcode"/);
    assert.match(search, /p\.barcode \|\| ''\)\.trim\(\)\.toLowerCase\(\) === normalized/);
  });

  it('PWA: service worker cache shell + manifest có icon maskable & shortcut', () => {
    assert.match(sw, /const CACHE = 'multipos-v213-1'/);
    assert.match(sw, /SHELL_URL = '\/'/);
    assert.match(sw, /caches\.match\(SHELL_URL\)/);
    assert.ok(existsSync(join(ROOT, 'public/icons/icon-maskable.svg')));
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
    assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);
  });

  it('shortcut /?screen= mở thẳng phân hệ tương ứng', () => {
    assert.match(store, /URLSearchParams\(window\.location\.search\)\.get\('screen'\)/);
  });

  it('Cài đặt có card trạng thái offline (cache catalog + SW + cài app)', () => {
    assert.match(offlineCard, /db\.products\.count\(\)/);
    assert.match(offlineCard, /navigator\.serviceWorker\.getRegistration\(\)/);
    assert.match(offlineCard, /beforeinstallprompt/);
    assert.match(offlineCard, /id="btn-check-app-update"/);
  });
});
