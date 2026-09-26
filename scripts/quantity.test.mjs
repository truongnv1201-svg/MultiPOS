// Unit test cho lib/quantity.ts — số lượng thập phân khi bán/nhập (2,15 kg).
// Chạy: npm test (node --test scripts/quantity.test.mjs). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QTY_MAX_DECIMALS,
  allowsDecimalQty,
  formatQty,
  parseQtyInput,
  qtyStep,
  roundQty,
  snapQty,
  suggestDecimalForUnit,
} from '../lib/quantity.ts';
import { recomputeOrderItem, calcCartTotals } from '../lib/pricing.ts';

describe('parse số lượng người dùng gõ', () => {
  it('chấp nhận cả dấu chấm và dấu phẩy kiểu VN', () => {
    assert.equal(parseQtyInput('2.15'), 2.15);
    assert.equal(parseQtyInput('2,15'), 2.15);
    assert.equal(parseQtyInput(' 2 . 15 '), 2.15);
    assert.equal(parseQtyInput('0.5'), 0.5);
    // Dấu chấm = hàng nghìn khi có dấu phẩy: "1.234,56" -> 1234.56
    assert.equal(parseQtyInput('1.234,56'), 1234.56);
  });

  it('rác -> 0, không sinh NaN', () => {
    assert.equal(parseQtyInput(''), 0);
    assert.equal(parseQtyInput('abc'), 0);
    assert.equal(parseQtyInput('-'), 0);
  });
});

describe('làm tròn theo numeric(14,3)', () => {
  it('giữ tối đa 3 chữ số thập phân, không để lỗi float', () => {
    assert.equal(QTY_MAX_DECIMALS, 3);
    assert.equal(roundQty(2.15), 2.15);
    assert.equal(roundQty(0.1 + 0.2), 0.3);
    assert.equal(roundQty(2.1505), 2.151);
  });
});

describe('snapQty — chuẩn hoá trước khi lưu', () => {
  it('hàng thập phân giữ nguyên 2,15', () => {
    assert.equal(snapQty(2.15, true), 2.15);
    assert.equal(snapQty(2.1504, true), 2.15);
    assert.equal(snapQty(2.1506, true), 2.151);
  });

  it('hàng đếm theo cái ép về số nguyên', () => {
    assert.equal(snapQty(2.4, false), 2);
    assert.equal(snapQty(2.6, false), 3);
    assert.equal(snapQty(2, false), 2);
  });

  it('luôn > 0 vì server chặn v_qty <= 0', () => {
    assert.equal(snapQty(0, true), 0.001);
    assert.equal(snapQty(-5, true), 0.001);
    assert.equal(snapQty(0, false), 1);
    assert.equal(snapQty(Number.NaN, true), 0.001);
  });
});

describe('cờ cho phép bán số lượng thập phân', () => {
  it('mặc định là CÓ (kể cả mặt hàng cũ chưa có cờ trong DB/cache)', () => {
    assert.equal(allowsDecimalQty({ product_type: 'goods' }), true);
    assert.equal(allowsDecimalQty({ product_type: 'goods', allow_decimal: true }), true);
    assert.equal(allowsDecimalQty({ product_type: 'area' }), true);
  });

  it('chỉ ép về số nguyên khi mặt hàng được tắt cờ', () => {
    assert.equal(allowsDecimalQty({ product_type: 'goods', allow_decimal: false }), false);
    assert.equal(allowsDecimalQty({ product_type: 'area', allow_decimal: false }), true);
    assert.equal(allowsDecimalQty(null), false);
  });

  it('gợi ý bật cờ cho đơn vị cân nặng/thể tích', () => {
    assert.equal(suggestDecimalForUnit('kg'), true);
    assert.equal(suggestDecimalForUnit('KG'), true);
    assert.equal(suggestDecimalForUnit('l'), true);
    assert.equal(suggestDecimalForUnit('kg/thùng'), true);
    assert.equal(suggestDecimalForUnit('chai'), false);
    assert.equal(suggestDecimalForUnit('m²'), false);
    assert.equal(suggestDecimalForUnit(undefined), false);
  });
});

describe('hiển thị và bước nhảy số lượng', () => {
  it('bỏ phần thập phân thừa 0, dùng dấu phẩy VN', () => {
    assert.equal(formatQty(2.15), '2,15');
    assert.equal(formatQty(2.15, false), '2');
    assert.equal(formatQty(3), '3');
  });

  it('hàng thập phân tăng/giảm theo bước 0,1', () => {
    assert.equal(qtyStep(true), 0.1);
    assert.equal(qtyStep(false), 1);
  });
});

describe('tính tiền với số lượng thập phân', () => {
  const item = (over = {}) => ({
    id: 'item-1',
    product_id: 'p-kg',
    sku: 'SP000900',
    name: 'Đinh đen',
    product_type: 'goods',
    unit: 'kg',
    unit_price: 60000,
    quantity: 2.15,
    discount_amount: 0,
    processing_fee: 0,
    subtotal: 0,
    ...over,
  });

  it('thành tiền = số lượng × đơn giá, làm tròn tiền (không tròn số lượng)', () => {
    const line = recomputeOrderItem(item());
    assert.equal(line.quantity, 2.15);
    assert.equal(line.subtotal, 129000);
  });

  it('chiết khấu trên dòng thập phân không làm lệch tiền', () => {
    const line = recomputeOrderItem(item({ discount_amount: 9000 }));
    assert.equal(line.quantity, 2.15);
    assert.equal(line.subtotal, 120000);
  });

  it('tổng giỏ cộng dồn đúng các dòng thập phân', () => {
    const cart = {
      items: [recomputeOrderItem(item()), recomputeOrderItem(item({ id: 'item-2', quantity: 0.35 }))],
      discount_amount: 0,
      discount_percent: 0,
      shipping_fee: 0,
      shipping_type: 'vnd',
      shipping_percent: 0,
      vat_percent: 0,
      payment_method: 'cash',
      tendered_amount: 150000,
    };
    const totals = calcCartTotals(cart, 500);
    assert.equal(totals.subtotal, 150000);
    assert.equal(totals.payable, 150000);
    assert.equal(totals.change_amount, 0);
  });
});
