// P3: mapping OrderItem local -> payload JSONB cho RPC pos_checkout (tách từ lib/store.tsx).
import type { OrderItem } from '../types';

export function toRpcItems(items: OrderItem[]) {
  return items.map((it) => ({
    sku: it.sku,
    name: it.name,
    item_type: it.product_type,
    unit: it.unit,
    quantity: it.quantity,
    unit_price: it.unit_price,
    discount_amount: it.discount_amount || 0,
    processing_fee: it.product_type === 'area' ? 0 : it.processing_fee || 0, // area: server tính lại từ JSONB
    waste_factor: it.waste_factor || 0,
    dimension_details: it.dimension_details || null,
  }));
}
