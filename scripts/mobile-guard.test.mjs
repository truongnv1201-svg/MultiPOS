// Test tĩnh bảo vệ Giai đoạn 2 (mobile-first): các bảng ngang phải có record list
// / bottom sheet thay thế trên điện thoại, và Sync Center phải mở được từ header.
// Chạy: npm test (node --test ...). Chỉ đọc file nên không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

  it('nút Làm mới cũ (header-refresh-btn) vẫn còn để E2E offline-sync dùng', () => {
    assert.match(header, /id="header-refresh-btn"/);
  });
});
