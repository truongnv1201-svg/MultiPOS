// Guard chi tiết master-detail: panel chi tiết + highlight CHỈ hiện mục đang
// nằm trong danh sách đã lọc. Bệnh đã gặp: lọc ra 0 dòng nhưng cột phải vẫn
// hiện đơn cũ ngoài bộ lọc (Hóa đơn, preset "Hôm nay").
//
// Quy tắc chốt cho cả 3 màn:
//   - Hóa đơn: selectedOrder suy từ filteredOrders (null stays null — giữ hành
//     vi xóa chọn khi đổi lọc để khỏi bấm nhầm Hủy đơn).
//   - Khách hàng/NCC: visibleCustomer/visibleSupplier gate phần hiển thị thụ
//     động; các luồng thao tác chủ động (sheet mobile, modal thu nợ/trả NCC,
//     sửa/xóa) giữ nguyên đối tượng đang làm dở.
//   - Placeholder "Chọn ... để xem chi tiết" phải còn (lọc 0 dòng không được
//     hiện chi tiết ma).
//
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('hoa don: chi tiet chi hien don trong bo loc', () => {
  const orders = read('components/orders/OrdersView.tsx');

  it('selectedOrder suy từ filteredOrders, không từ orders thô', () => {
    assert.ok(!/orders\.find\(\(o\) => o\.id === selectedOrderId/.test(orders), 'cấm tìm trong orders thô');
    assert.match(orders, /filteredOrders\.find\(\(o\) => o\.id === selectedOrderId/);
    assert.match(orders, /filteredOrders\.find\(\(o\) => o\.order_code === selectedOrderCode\)/);
  });

  it('null stays null (giữ hành vi xóa chọn khi đổi lọc)', () => {
    assert.match(orders, /if \(!selectedOrderId && !selectedOrderCode\) return null;/);
  });

  it('còn placeholder khi không có đơn nào được chọn', () => {
    assert.match(orders, /Chọn đơn hàng để xem chi tiết/);
  });

  it('panel chi tiết hiện ghi chú đơn (không lưu mà không hiện)', () => {
    assert.match(orders, /selectedOrder\.note &&/);
    assert.match(orders, /Ghi chú: <\/span>/);
  });
});

describe('don nhap: chi tiet chi hien phieu trong bo loc', () => {
  const view = read('components/imports/ImportsView.tsx');

  it('selectedPo suy từ filteredPos, không từ purchaseOrders thô', () => {
    assert.ok(!/purchaseOrders\.find\(\(p\) => p\.id === selectedPoId/.test(view), 'cấm tìm trong purchaseOrders thô');
    assert.match(view, /filteredPos\.find\(\(p\) => p\.id === selectedPoId\)/);
    assert.match(view, /filteredPos\.find\(\(p\) => p\.code === selectedPoCode\)/);
  });

  it('null stays null (giữ hành vi xóa chọn khi đổi lọc)', () => {
    assert.match(view, /if \(!selectedPoId && !selectedPoCode\) return null;/);
  });

  it('còn placeholder khi không có phiếu nào được chọn', () => {
    assert.match(view, /Chọn phiếu nhập để xem chi tiết/);
  });
});

describe('nhập kho: ghi chú phiếu được lưu local (khỏi rơi mất)', () => {
  it('PurchaseOrder có trường note + poRecord ghi note đã trim', () => {
    const types = read('lib/types.ts');
    assert.match(types, /note\?: string;\n  created_at: string;\n\}/);
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /note: note\.trim\(\) \|\| undefined,/);
  });
});

describe('khach hang: chi tiet chi hien khach trong bo loc', () => {
  const customers = read('components/customers/CustomersView.tsx');

  it('có visibleCustomer gate theo filteredCustomers', () => {
    assert.match(customers, /const visibleCustomer =/);
    assert.match(customers, /filteredCustomers\.some\(\(c\) => c\.id === selectedCustomer\.id\)/);
  });

  it('highlight + panel desktop dùng visibleCustomer', () => {
    assert.match(customers, /visibleCustomer\?\.id === c\.id/);
    assert.match(customers, /\{visibleCustomer \? \(/);
  });

  it('luồng thao tác (sheet mobile, modal thu nợ) giữ nguyên selectedCustomer', () => {
    assert.match(customers, /\{isMobileDetailOpen && selectedCustomer && \(/);
    assert.match(customers, /open=\{isCollectModalOpen && !!selectedCustomer\}/);
  });
});

describe('ncc: chi tiet chi hien ncc trong bo loc', () => {
  const suppliers = read('components/suppliers/SuppliersView.tsx');

  it('có visibleSupplier gate theo filteredSuppliers', () => {
    assert.match(suppliers, /const visibleSupplier =/);
    assert.match(suppliers, /filteredSuppliers\.some\(\(s\) => s\.id === liveSelectedSupplier\.id\)/);
  });

  it('highlight + panel desktop dùng visibleSupplier', () => {
    assert.match(suppliers, /visibleSupplier\?\.id === sup\.id/);
    assert.match(suppliers, /\{visibleSupplier \? \(/);
  });

  it('sheet mobile giữ nguyên liveSelectedSupplier', () => {
    assert.match(suppliers, /\{isMobileDetailOpen && liveSelectedSupplier && \(/);
  });
});
