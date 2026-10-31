// Guard "Sửa đơn bán" — draft thuần (lib/sale-edit.ts) + mối nối UI/store.
// Chạy: npm test. Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSaleEditDraft } from '../lib/sale-edit.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const product = (over = {}) => ({
  id: 'p1',
  sku: 'SP1',
  name: 'Thép hộp',
  unit: 'cây',
  product_type: 'goods',
  retail_price: 100000,
  import_price: 60000,
  avg_cost: 60000,
  stock_quantity: 50,
  ...over,
});

const item = (over = {}) => ({
  id: 'item-old',
  product_id: 'p1',
  sku: 'SP1',
  name: 'Thép hộp',
  product_type: 'goods',
  unit: 'cây',
  unit_price: 90000,
  quantity: 2,
  discount_amount: 0,
  processing_fee: 0,
  subtotal: 180000,
  unit_cost: 60000,
  price_override: true,
  ...over,
});

const order = (over = {}) => ({
  id: 'o-1',
  order_code: 'HD-251031-0001',
  customer_name: 'Khách Lẻ Mua Tại Quầy',
  items: [item()],
  subtotal: 180000,
  discount_amount: 0,
  discount_percent: 0,
  shipping_fee: 0,
  total_amount: 180000,
  paid_amount: 180000,
  debt_amount: 0,
  change_amount: 0,
  payments: [{ method: 'cash', amount: 180000 }],
  status: 'completed',
  created_at: '2026-10-31T02:00:00Z',
  cashier_name: 'Thu ngân A',
  ...over,
});

describe('buildSaleEditDraft: dựng tab sửa', () => {
  it('lấy giá niêm yết hiện tại, cấp id mới, bỏ vốn/override cũ', () => {
    const res = buildSaleEditDraft(order(), [product()], [], []);
    assert.equal(res.ok, true);
    const [line] = res.draft.items;
    assert.equal(line.unit_price, 100000);
    assert.equal(line.subtotal, 200000);
    assert.notEqual(line.id, 'item-old');
    assert.equal(line.unit_cost, undefined);
    assert.equal(line.price_override, undefined);
    assert.equal(res.draft.repriced, 1);
    assert.equal(res.draft.customer_name, 'Khách Lẻ Mua Tại Quầy');
  });

  it('map theo sku khi product_id đã đổi', () => {
    const res = buildSaleEditDraft(
      order({ items: [item({ product_id: 'gone' })] }),
      [product()],
      [],
      [],
    );
    assert.equal(res.ok, true);
    assert.equal(res.draft.items[0].product_id, 'p1');
    assert.equal(res.draft.dropped.length, 0);
  });

  it('bỏ dòng có sản phẩm đã xóa; còn 0 dòng thì chặn', () => {
    const res = buildSaleEditDraft(
      order({ items: [item({ product_id: 'gone', sku: 'XX' })] }),
      [product()],
      [],
      [],
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'empty');

    const mixed = buildSaleEditDraft(
      order({ items: [item(), item({ id: 'x', product_id: 'gone', sku: 'XX', name: 'Đã xóa' })] }),
      [product()],
      [],
      [],
    );
    assert.equal(mixed.ok, true);
    assert.deepEqual(mixed.draft.dropped, [{ name: 'Đã xóa', sku: 'XX' }]);
  });

  it('kẹp giảm giá bill về đúng tiền hàng mới', () => {
    const res = buildSaleEditDraft(order({ discount_amount: 500000 }), [product()], [], []);
    assert.equal(res.draft.discount_amount, 200000);
    assert.equal(res.draft.clampedDiscount, true);
  });

  it('kẹp giảm giá dòng vượt tiền hàng dòng', () => {
    const res = buildSaleEditDraft(
      order({ items: [item({ discount_amount: 999999 })] }),
      [product()],
      [],
      [],
    );
    assert.equal(res.draft.items[0].discount_amount, 200000);
    assert.equal(res.draft.items[0].subtotal, 0);
    assert.equal(res.draft.clampedDiscount, true);
  });

  it('khách đã xóa -> Khách lẻ; khách còn -> lấy tên/SĐT hiện tại', () => {
    const gone = buildSaleEditDraft(order({ customer_id: 'c-gone' }), [product()], [], []);
    assert.equal(gone.draft.customer_name, 'Khách Lẻ Mua Tại Quầy');
    assert.equal(gone.draft.customer_id, undefined);
    assert.equal(gone.draft.customerFallback, true);

    const found = buildSaleEditDraft(
      order({ customer_id: 'c1', customer_name: 'Tên cũ', customer_phone: '0900' }),
      [product()],
      [{ id: 'c1', code: 'KH1', name: 'Tên mới', phone: '0911', group: 'retail', current_debt: 0, debt_limit: 0, created_at: '' }],
      [],
    );
    assert.equal(found.draft.customer_name, 'Tên mới');
    assert.equal(found.draft.customer_phone, '0911');
    assert.equal(found.draft.customerFallback, false);
  });

  it('kênh tiền lấy từ sổ quỹ (đơn server mất method thật)', () => {
    const cashbook = [
      {
        id: 'cb1', code: 'PT1', type: 'receipt', fund_type: 'bank', category: 'sales',
        amount: 180000, reference_order_code: 'HD-251031-0001', note: '', created_at: '2026-10-31T02:00:00Z',
      },
    ];
    const res = buildSaleEditDraft(order(), [product()], [], cashbook);
    assert.equal(res.draft.payment_method, 'transfer');
    assert.equal(res.draft.tendered_amount, 180000);

    const debt = buildSaleEditDraft(order({ paid_amount: 0, payments: [] }), [product()], [], []);
    assert.equal(debt.draft.payment_method, 'debt');
    assert.equal(debt.draft.tendered_amount, 0);
  });

  it('đơn legacy gộp VAT (percent 0) -> cảnh báo, không bịa %', () => {
    const res = buildSaleEditDraft(order({ vat_amount: 8000, vat_percent: 0 }), [product()], [], []);
    assert.equal(res.draft.vat_percent, 0);
    assert.equal(res.draft.vatDropped, true);

    const kept = buildSaleEditDraft(order({ vat_amount: 8000, vat_percent: 8 }), [product()], [], []);
    assert.equal(kept.draft.vat_percent, 8);
    assert.equal(kept.draft.vatDropped, false);
  });

  it('hàng đo m2: tính lại SL/phí từ dimension_details', () => {
    const res = buildSaleEditDraft(
      order({
        items: [item({
          product_type: 'area',
          unit: 'm2',
          quantity: 99,
          unit_price: 90000,
          subtotal: 999,
          dimension_details: [
            { length: 2, width: 1, quantity: 1, actual_m2: 2, perimeter_md: 6, processing_fee: 30000 },
          ],
          waste_factor: 5,
        })],
      }),
      [product({ product_type: 'area', unit: 'm2', waste_factor: 5 })],
      [],
      [],
    );
    const [line] = res.draft.items;
    assert.equal(line.quantity, 2);
    assert.equal(line.processing_fee, 30000);
    assert.equal(line.subtotal, 230000);
    assert.equal(line.material_consumed, 2.1);
  });

  it('ghi chú có dấu vết đơn cũ', () => {
    const res = buildSaleEditDraft(order({ note: 'giao gấp' }), [product()], [], []);
    assert.equal(res.draft.note, 'Sửa từ HD-251031-0001 — giao gấp');
  });
});

describe('mối nối Sửa đơn trong app', () => {
  it('sale-edit không gửi price_override lên server', () => {
    const src = read('lib/sale-edit.ts');
    assert.ok(!/price_override/.test(src), 'không được giữ price_override khi điền lại');
  });

  it('cart có openSaleEditTab và chặn quá 3 tab', () => {
    const cart = read('lib/store/tx/cart.tsx');
    assert.match(cart, /openSaleEditTab/);
    assert.match(cart, /reason: 'tab_limit' \| 'empty'/);
    const store = read('lib/store.tsx');
    assert.match(store, /openSaleEditTab,/);
  });

  it('OrdersView: nút Sửa đơn chỉ cho đơn hoàn tất, mở tab trước khi hủy', () => {
    const src = read('components/orders/OrdersView.tsx');
    assert.match(src, /Sửa đơn \(hủy & tạo lại\)/);
    assert.match(src, /buildSaleEditDraft\(/);
    const openAt = src.indexOf('openSaleEditTab(draft)');
    const cancelAt = src.indexOf('cancelOrder(order.id)');
    assert.ok(openAt > 0 && cancelAt > openAt, 'phải mở tab trước khi hủy');
    assert.match(src, /closeCartTab\(opened\.tabId\)/);
    assert.match(src, /handleEditOrder/);
  });

  it('Hủy chỉ hiện với đơn hoàn tất (không còn nút chết ở đơn đã trả)', () => {
    const src = read('components/orders/OrdersView.tsx');
    assert.match(src, /selectedOrder\.status === 'completed' && \(\s*<button\s*onClick=\{\(\) => handleCancelOrder/);
  });

  it('cancelOrder sync đơn offline trước khi quyết định local/server', () => {
    const src = read('lib/store/tx/order-returns.ts');
    const syncAt = src.indexOf('await syncPendingOrders()');
    const resolveAt = src.indexOf('const serverId = await resolveServerOrderId(current)');
    assert.ok(syncAt > 0 && resolveAt > syncAt, 'syncPendingOrders phải chạy trước resolveServerOrderId');
    assert.match(src, /refreshServerCashbook\(\)/);
    assert.match(src, /refreshCatalog\(\)/);
  });

  it('hoàn counter ca có điều kiện cùng ca + cùng thu ngân', () => {
    const src = read('lib/store/tx/order-returns.ts');
    assert.match(src, /current\.cashier_name === currentShift\.cashier_name/);
    assert.match(src, /current\.created_at >= currentShift\.opened_at/);
    assert.match(src, /cash_sales: isCash \? Math\.max\(0, currentShift\.cash_sales - current\.paid_amount\)/);
  });
});
