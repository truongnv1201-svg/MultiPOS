// Unit test cho lib/pricing.ts (single source toán tiền local).
// Chạy: npm test  (node --test scripts/pricing.test.mjs)
// Không cần mạng/DB — khóa công thức local; đối chiếu server ở verify-pricing-parity.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDimensionRow,
  recomputeOrderItem,
  calcCartTotals,
  resolvePaidAmount,
} from '../lib/pricing.ts';

const goods = (over = {}) => ({
  id: 'item-1',
  product_id: 'p1',
  sku: 'SP000007',
  name: 'Keo',
  product_type: 'goods',
  unit: 'chai',
  unit_price: 62000,
  quantity: 4,
  discount_amount: 0,
  processing_fee: 0,
  subtotal: 248000,
  ...over,
});

const cart = (over = {}) => ({
  items: [],
  discount_amount: 0,
  discount_percent: 0,
  shipping_fee: 0,
  shipping_type: 'vnd',
  shipping_percent: 0,
  vat_percent: 0,
  payment_method: 'cash',
  tendered_amount: 0,
  ...over,
});

describe('calculateDimensionRow', () => {
  it('tấm 1.5x2.0 x2 mài 20k/md: md=14, m2=6, phí=280000', () => {
    const r = calculateDimensionRow({
      id: 'd1', length: 1.5, width: 2.0, quantity: 2, grinding_type: 'xiet_bong',
      grinding_unit_price: 20000, holes: 0, hole_unit_price: 25000, corners: 0, corner_unit_price: 15000,
    });
    assert.equal(r.perimeter_md, 14);
    assert.equal(r.actual_m2, 6);
    assert.equal(r.processing_fee, 280000);
  });

  it('lỗ + góc legacy + phụ phí tay cộng dồn', () => {
    const r = calculateDimensionRow({
      id: 'd1', length: 1, width: 1, quantity: 1, grinding_type: 'none',
      grinding_unit_price: 0, holes: 2, hole_unit_price: 25000, corners: 4, corner_unit_price: 15000,
      extra_fee: 10000,
    });
    assert.equal(r.processing_fee, 50000 + 60000 + 10000);
  });

  it('extra_fee âm kẹp về 0', () => {
    const r = calculateDimensionRow({
      id: 'd1', length: 1, width: 1, quantity: 1, grinding_type: 'none',
      grinding_unit_price: 0, holes: 0, hole_unit_price: 0, corners: 0, corner_unit_price: 0,
      extra_fee: -5000,
    });
    assert.equal(r.extra_fee, 0);
    assert.equal(r.processing_fee, 0);
  });

  it('làm tròn md 2 số, m2 3 số', () => {
    const r = calculateDimensionRow({
      id: 'd1', length: 1.333, width: 2.666, quantity: 1, grinding_type: 'none',
      grinding_unit_price: 0, holes: 0, hole_unit_price: 0, corners: 0, corner_unit_price: 0,
    });
    assert.equal(r.perimeter_md, 8);
    assert.equal(r.actual_m2, 3.554);
  });
});

describe('recomputeOrderItem', () => {
  it('hàng area: m2 + phí mài thành subtotal, hao hụt vào material', () => {
    const it = recomputeOrderItem({
      ...goods(),
      product_type: 'area',
      unit: 'm²',
      unit_price: 380000,
      quantity: 0,
      subtotal: 0,
      waste_factor: 5,
      dimension_details: [{
        id: 'd1', length: 1.5, width: 2.0, quantity: 2, grinding_type: 'x',
        grinding_unit_price: 20000, holes: 0, hole_unit_price: 0, corners: 0,
        corner_unit_price: 0, perimeter_md: 14, actual_m2: 6, processing_fee: 280000,
      }],
    });
    assert.equal(it.quantity, 6);
    assert.equal(it.processing_fee, 280000);
    assert.equal(it.material_consumed, 6.3);
    assert.equal(it.subtotal, 2560000);
  });

  it('CK dòng trừ thẳng vào subtotal', () => {
    const it = recomputeOrderItem({ ...goods(), discount_amount: 8000 });
    assert.equal(it.subtotal, 240000);
  });

  it('CK vượt tổng kẹp về 0 (không âm)', () => {
    const it = recomputeOrderItem({ ...goods(), discount_amount: 999999 });
    assert.equal(it.subtotal, 0);
  });
});

describe('calcCartTotals', () => {
  it('cash đủ tiền thừa: 4 keo 248000, đưa 250000 -> thối 2000, không làm tròn', () => {
    const t = calcCartTotals(cart({ items: [goods()], tendered_amount: 250000 }), 500);
    assert.equal(t.subtotal, 248000);
    assert.equal(t.cash_rounding, 0);
    assert.equal(t.payable, 248000);
    assert.equal(t.change_amount, 2000);
    assert.equal(t.debt_amount, 0);
  });

  it('VAT 8% + cash: 124000 -> vat 9920, rounding 420, payable 133500', () => {
    const t = calcCartTotals(
      cart({ items: [goods({ quantity: 2, subtotal: 124000 })], vat_percent: 8, tendered_amount: 150000 }), 500);
    assert.equal(t.vat_amount, 9920);
    assert.equal(t.cash_rounding, 420);
    assert.equal(t.payable, 133500);
    assert.equal(t.change_amount, 16500);
  });

  it('transfer không làm tròn dù raw lẻ', () => {
    const t = calcCartTotals(
      cart({ items: [goods({ quantity: 2, subtotal: 124000 })], vat_percent: 8, payment_method: 'transfer', tendered_amount: 133920 }), 500);
    assert.equal(t.cash_rounding, 0);
    assert.equal(t.payable, 133920);
    assert.equal(t.change_amount, 0);
  });

  it('ghi nợ: debt = payable, change = 0', () => {
    const t = calcCartTotals(cart({ items: [goods()], payment_method: 'debt' }), 500);
    assert.equal(t.debt_amount, 248000);
    assert.equal(t.change_amount, 0);
  });

  it('trả thiếu tiền mặt -> phần còn lại thành nợ', () => {
    const t = calcCartTotals(cart({ items: [goods()], tendered_amount: 200000 }), 500);
    assert.equal(t.debt_amount, 48000);
    assert.equal(t.change_amount, 0);
  });

  it('CK % tính trước VAT/ship: CK10% trên 124000 + VAT8%', () => {
    const t = calcCartTotals(cart({
      items: [goods({ quantity: 2, subtotal: 124000 })],
      discount_percent: 10, vat_percent: 8, payment_method: 'transfer', tendered_amount: 120528,
    }), 500);
    assert.equal(t.discount_amount, 12400);
    assert.equal(t.vat_amount, 8928); // VAT trên (124000-12400), không gồm ship
    assert.equal(t.payable, 120528);
  });

  it('CK số tiền (khớp case server verify-vat): CK 24000 + VAT8% -> vat 8000', () => {
    const t = calcCartTotals(cart({
      items: [goods({ quantity: 2, subtotal: 124000 })],
      discount_amount: 24000, vat_percent: 8, payment_method: 'transfer', tendered_amount: 108000,
    }), 500);
    assert.equal(t.vat_amount, 8000);
    assert.equal(t.payable, 108000);
  });

  it('ship % trên (tiền hàng - CK)', () => {
    const t = calcCartTotals(cart({
      items: [goods({ subtotal: 100000 })],
      discount_amount: 24000, shipping_type: 'percent', shipping_percent: 10,
      payment_method: 'transfer', tendered_amount: 83600,
    }), 500);
    assert.equal(t.shipping_fee, 7600);
    assert.equal(t.payable, 83600);
  });

  it('CK vượt tiền hàng -> payable kẹp 0', () => {
    const t = calcCartTotals(cart({ items: [goods()], discount_amount: 999999, tendered_amount: 1000 }), 500);
    assert.equal(t.payable, 0);
    assert.equal(t.change_amount, 1000);
  });

  it('mệnh giá làm tròn theo setting (1000 -> rounding 920)', () => {
    const t = calcCartTotals(
      cart({ items: [goods({ quantity: 2, subtotal: 124000 })], vat_percent: 8, tendered_amount: 150000 }), 1000);
    assert.equal(t.cash_rounding, 920);
    assert.equal(t.payable, 133000);
  });

  it('giỏ trống -> toàn 0', () => {
    const t = calcCartTotals(cart(), 500);
    assert.deepEqual(t, {
      subtotal: 0, discount_amount: 0, shipping_fee: 0, vat_amount: 0, vat_percent: 0,
      cash_rounding: 0, payable: 0, change_amount: 0, debt_amount: 0,
    });
  });
});

describe('resolvePaidAmount', () => {
  it('debt luôn 0', () => assert.equal(resolvePaidAmount(100000, 'debt', 100000), 0));
  it('cash thiếu -> min, cash trống -> 0', () => {
    assert.equal(resolvePaidAmount(100000, 'cash', 60000), 60000);
    assert.equal(resolvePaidAmount(100000, 'cash', 0), 0);
    assert.equal(resolvePaidAmount(100000, 'cash', 150000), 100000);
  });
  it('transfer/card trống = trả đủ', () => {
    assert.equal(resolvePaidAmount(100000, 'transfer', 0), 100000);
    assert.equal(resolvePaidAmount(100000, 'card', 40000), 40000);
  });
});
