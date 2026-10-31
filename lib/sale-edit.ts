// Dựng giỏ hàng "Sửa đơn" từ đơn đã bán: giá theo niêm yết hiện tại, bỏ dòng có
// sản phẩm đã xóa, kẹp giảm giá về đúng tiền hàng mới. Module thuần để node --test
// chạy trực tiếp (không import Dexie/browser), giống lib/pricing.ts.
import type { CashbookEntry, Customer, Order, OrderItem, Product } from './types';
import { recomputeOrderItem } from './pricing.ts';

export interface SaleEditDraft {
  items: OrderItem[];
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  discount_amount: number;
  discount_percent: number;
  shipping_fee: number;
  vat_percent: number;
  payment_method: 'cash' | 'transfer' | 'debt';
  note: string;
  tendered_amount: number;
  dropped: { name: string; sku: string }[];
  repriced: number;
  clampedDiscount: boolean;
  customerFallback: boolean;
  vatDropped: boolean;
}

export type SaleEditResult =
  | { ok: true; draft: SaleEditDraft }
  | { ok: false; reason: 'empty' };

const WALK_IN_NAME = 'Khách Lẻ Mua Tại Quầy';

// Kênh tiền của đơn cũ: sổ quỹ là chân lý (đơn kéo từ server mất phương thức thật,
// mọi dòng server đều gán synthetic 'cash'). Không thấy receipt -> theo payments.
function paymentMethodOf(
  order: Order,
  cashbook: CashbookEntry[],
): 'cash' | 'transfer' | 'debt' {
  if (!(order.paid_amount > 0)) return 'debt';
  const receipts = cashbook.filter(
    (e) => e.type === 'receipt' && e.reference_order_code === order.order_code,
  );
  if (receipts.length > 0) {
    const top = receipts.reduce((a, b) => (a.amount >= b.amount ? a : b));
    return top.fund_type === 'cash' ? 'cash' : 'transfer';
  }
  const method = order.payments[0]?.method;
  return method === 'transfer' || method === 'card' ? 'transfer' : 'cash';
}

export function buildSaleEditDraft(
  order: Order,
  products: Product[],
  customers: Customer[],
  cashbook: CashbookEntry[],
): SaleEditResult {
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const items: OrderItem[] = [];
  const dropped: { name: string; sku: string }[] = [];
  let repriced = 0;
  let clampedDiscount = false;
  const stamp = Date.now();

  order.items.forEach((it, index) => {
    const product = byId.get(it.product_id) || bySku.get(it.sku);
    if (!product) {
      dropped.push({ name: it.name, sku: it.sku });
      return;
    }
    if (product.retail_price !== it.unit_price) repriced += 1;
    let next: OrderItem = {
      id: `item-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      product_type: product.product_type,
      unit: product.unit,
      unit_price: product.retail_price,
      quantity: it.quantity,
      discount_amount: Math.max(0, it.discount_amount || 0),
      processing_fee: it.processing_fee || 0,
      subtotal: 0,
      dimension_details: it.dimension_details,
      waste_factor: product.waste_factor ?? it.waste_factor,
    };
    next = recomputeOrderItem(next);
    const gross = Math.max(0, next.quantity * next.unit_price + (next.processing_fee || 0));
    if (next.discount_amount > gross) {
      next = recomputeOrderItem({ ...next, discount_amount: gross });
      clampedDiscount = true;
    }
    items.push(next);
  });

  if (items.length === 0) return { ok: false, reason: 'empty' };

  const itemsSubtotal = items.reduce((sum, it) => sum + it.subtotal, 0);
  let discount = Math.max(0, order.discount_amount || 0);
  if (discount > itemsSubtotal) {
    discount = itemsSubtotal;
    clampedDiscount = true;
  }

  const customer = order.customer_id
    ? customers.find((c) => c.id === order.customer_id)
    : undefined;
  const customerFallback = !!order.customer_id && !customer;
  const vatPercent = Math.min(100, Math.max(0, order.vat_percent || 0));
  const vatDropped = (order.vat_amount || 0) > 0 && vatPercent === 0;

  return {
    ok: true,
    draft: {
      items,
      customer_id: customer ? customer.id : undefined,
      customer_name: customer?.name || (customerFallback ? WALK_IN_NAME : order.customer_name || WALK_IN_NAME),
      customer_phone: customer?.phone || order.customer_phone,
      // Giữ tuyệt đối (đồng) thay vì %: giá niêm yết có thể đã đổi nên % cũ không
      // còn tương đương số tiền khách đã được giảm.
      discount_amount: discount,
      discount_percent: 0,
      shipping_fee: Math.max(0, order.shipping_fee || 0),
      vat_percent: vatPercent,
      payment_method: paymentMethodOf(order, cashbook),
      note: order.note ? `Sửa từ ${order.order_code} — ${order.note}` : `Sửa từ ${order.order_code}`,
      tendered_amount: order.paid_amount > 0 ? order.paid_amount : 0,
      dropped,
      repriced,
      clampedDiscount,
      customerFallback,
      vatDropped,
    },
  };
}
