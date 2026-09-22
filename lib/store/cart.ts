// P3: tab giỏ hàng POS (tách từ lib/store.tsx).
import type { CartTab } from './types';

export const DEFAULT_TAB: CartTab = {
  id: 'tab-1',
  name: 'HD 1',
  customer_name: 'Khách Lẻ Mua Tại Quầy',
  items: [],
  discount_amount: 0,
  discount_percent: 0,
  shipping_fee: 0,
  shipping_type: 'vnd',
  shipping_percent: 0,
  vat_percent: 0,
  price_book: 'retail',
  tendered_amount: 0,
  payment_method: 'cash',
  note: '',
  is_deposit_mode: false,
};
