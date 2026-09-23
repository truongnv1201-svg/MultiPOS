// P3: types dùng chung của store (tách từ lib/store.tsx — re-export ở đó để giữ import cũ).
import type { OrderItem } from '../types';

export interface CartTab {
  id: string;
  name: string; // HD 1, HD 2, etc.
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  items: OrderItem[];
  discount_amount: number;
  discount_percent: number;
  shipping_fee: number;
  shipping_type: 'vnd' | 'percent'; // P?: phụ phí theo đ hoặc % trên (tiền hàng - giảm giá)
  shipping_percent: number;
  vat_percent: number;
  price_book: 'retail' | 'trade';
  tendered_amount: number;
  payment_method: 'cash' | 'transfer' | 'card' | 'debt';
  note: string;
  is_deposit_mode: boolean; // Ctrl + F9
  checkout_uuid?: string; // UUID idempotency cho lần checkout hiện tại (0029) — giữ qua
  // retry (server rớt response mà đơn đã tạo), xoay sau mỗi checkout thành công.
}

export interface EmployeeInput {
  id?: string;
  full_name: string;
  phone?: string;
  position?: string;
  salary_type: 'daily' | 'monthly';
  daily_wage?: number;
  monthly_salary?: number;
  allowance_default?: number;
  start_date?: string;
  user_id?: string; // gắn tài khoản đăng nhập (gộp thành một với hồ sơ)
}

// Tài khoản đăng nhập (profiles) để gắn vào hồ sơ HRM
export interface HrmAccount {
  id: string;
  full_name: string;
  role: string;
  email?: string;
}

// Kết quả trả hàng (0025): hoàn tiền + hoàn kho có chính sách
export interface RestockLine {
  sku: string;
  quantity: number;
}
export interface ReturnSkipped {
  sku: string;
  reason: string;
}
export interface ReturnResult {
  ok: boolean;
  restocked: RestockLine[];
  skipped: ReturnSkipped[];
}
