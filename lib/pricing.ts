// Single source of truth cho toán tiền (P3-test): mọi công thức tiền local sống ở đây,
// store/POS chỉ gọi. Server SQL (0023) implement cùng công thức — scripts/verify-pricing*
// khóa 2 phía khớp từng đồng. Module thuần (không import Dexie/browser) để Node import
// trực tiếp chạy test (node --test) mà không cần transpile.
import type { DimensionDetail, OrderItem } from './types';

// Tính 1 dòng đo đạc: chu vi md, diện tích m2 thực, phí gia công.
// processing_fee = phí mài (chu vi × đơn giá) + phụ phí nhập tay (+ legacy lỗ/góc)
export function calculateDimensionRow(row: Omit<DimensionDetail, 'perimeter_md' | 'actual_m2' | 'processing_fee'>): DimensionDetail {
  const perimeter_md = Math.round(2 * (row.length + row.width) * row.quantity * 100) / 100;
  const actual_m2 = Math.round(row.length * row.width * row.quantity * 1000) / 1000;
  const grinding_fee = Math.round(perimeter_md * (row.grinding_unit_price || 0));
  const hole_fee = Math.round((row.holes || 0) * (row.hole_unit_price || 25000));
  const corner_fee = Math.round((row.corners || 0) * (row.corner_unit_price || 15000));
  const extra_fee = Math.max(0, Math.round(row.extra_fee || 0));
  const processing_fee = grinding_fee + hole_fee + corner_fee + extra_fee;

  return {
    ...row,
    extra_fee,
    perimeter_md,
    actual_m2,
    processing_fee,
  };
}

// Tính lại tổng dòng hàng từ chi tiết đo (NEW-CONF-04)
export function recomputeOrderItem(item: OrderItem): OrderItem {
  if (item.product_type === 'area' && item.dimension_details && item.dimension_details.length > 0) {
    const total_m2 = item.dimension_details.reduce((sum, d) => sum + d.actual_m2, 0);
    const total_processing_fee = item.dimension_details.reduce((sum, d) => sum + d.processing_fee, 0);
    const waste = item.waste_factor || 0;
    const material_consumed = Math.round(total_m2 * (1 + waste / 100) * 1000) / 1000;
    const subtotal = Math.round(total_m2 * item.unit_price + total_processing_fee - item.discount_amount);

    return {
      ...item,
      quantity: Math.round(total_m2 * 1000) / 1000,
      processing_fee: total_processing_fee,
      material_consumed,
      subtotal: Math.max(0, subtotal),
    };
  }

  const subtotal = Math.round(item.quantity * item.unit_price + (item.processing_fee || 0) - item.discount_amount);
  return {
    ...item,
    subtotal: Math.max(0, subtotal),
  };
}

export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'debt';

export interface CartTotalsInput {
  items: OrderItem[];
  discount_amount: number;
  discount_percent: number;
  shipping_fee: number;
  shipping_type: 'vnd' | 'percent';
  shipping_percent: number;
  vat_percent: number;
  payment_method: PaymentMethod;
  tendered_amount: number;
}

export interface CartTotals {
  subtotal: number;
  discount_amount: number;
  shipping_fee: number;
  vat_amount: number;
  vat_percent: number;
  cash_rounding: number;
  payable: number;
  change_amount: number;
  debt_amount: number;
}

// Tổng giỏ: hàng - CK bill + ship (đ/% trên tiền hàng sau CK) + VAT% (trên tiền hàng sau CK,
// không gồm ship) - làm tròn tiền mặt (chỉ khi method='cash', theo mệnh giá server).
export function calcCartTotals(cart: CartTotalsInput, cashRounding: number): CartTotals {
  const subtotal = cart.items.reduce((sum, item) => sum + item.subtotal, 0);
  let discount = cart.discount_amount;
  if (cart.discount_percent > 0) {
    discount = Math.round((subtotal * cart.discount_percent) / 100);
  }
  // Phụ phí: đ cố định hoặc % trên (tiền hàng - giảm giá), giống logic VAT
  const shippingBase = Math.max(0, subtotal - discount);
  const shipping =
    cart.shipping_type === 'percent'
      ? Math.round((shippingBase * (cart.shipping_percent || 0)) / 100)
      : cart.shipping_fee || 0;
  const vat_percent = cart.vat_percent || 0;
  const taxableBase = Math.max(0, subtotal - discount);
  const vat_amount = Math.round((taxableBase * vat_percent) / 100);

  // Cash Rounding Floor: ONLY if payment method is 'cash' (NEW-CONF-03).
  // Dùng mệnh giá server (settings.cash_rounding, default 500) thay vì hard-code,
  // nếu không đổi setting 100/1000/5000 ở server sẽ lệch total với RPC.
  let cash_rounding = 0;
  if (cart.payment_method === 'cash') {
    const roundingDenom = cashRounding > 0 ? cashRounding : 500;
    const rawPayable = Math.max(0, subtotal + shipping + vat_amount - discount);
    cash_rounding = rawPayable % roundingDenom;
  }

  const payable = Math.max(0, subtotal + shipping + vat_amount - discount - cash_rounding);
  const tendered = cart.tendered_amount || 0;

  let change_amount = 0;
  let debt_amount = 0;

  if (cart.payment_method === 'debt') {
    debt_amount = payable;
    change_amount = 0;
  } else if (tendered >= payable) {
    change_amount = tendered - payable;
    debt_amount = 0;
  } else {
    change_amount = 0;
    debt_amount = payable - tendered;
  }

  return {
    subtotal,
    discount_amount: discount,
    shipping_fee: shipping,
    vat_amount,
    vat_percent,
    cash_rounding,
    payable,
    change_amount,
    debt_amount,
  };
}

// Số tiền khách đã trả hiệu dụng từ ô tendered:
// Ô trống = trả đủ CHỈ cho chuyển khoản/quẹt thẻ; tiền mặt bắt buộc đã nhập (UI chặn),
// nợ ghi 0 để rơi vào guard nợ vô chủ. Dùng chung cho POSScreen (chặn nợ vô chủ) và
// checkout (số paid gửi server) — trước đây 2 nơi implement riêng, dễ lệch.
export function resolvePaidAmount(payable: number, method: PaymentMethod, tendered: number): number {
  if (method === 'debt') return 0;
  if (method === 'cash') return Math.min(payable, tendered || 0);
  return Math.min(payable, tendered || payable);
}
