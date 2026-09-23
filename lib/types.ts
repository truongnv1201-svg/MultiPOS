export type ProductType = 'goods' | 'area' | 'combo' | 'service';

export interface DimensionDetail {
  id: string;
  length: number; // mét (m), e.g., 1.50
  width: number; // mét (m), e.g., 2.00
  quantity: number; // số tấm, e.g., 2
  grinding_type: string; // 'none' | 'xiet_bong' | 'huynh_vat' | 'mo_vit' | 'luc_giac'
  grinding_unit_price: number; // đ/md, e.g., 20000
  holes: number; // số lỗ khoét (legacy — UI mới nhập phụ phí tay)
  hole_unit_price: number; // đ/lỗ, e.g., 25000
  corners: number; // số góc bo (legacy)
  corner_unit_price: number; // đ/góc, e.g., 15000
  extra_fee?: number; // Phụ phí nhập tay mỗi dòng (đ) — thay cho lỗ/góc từ v2.13
  perimeter_md: number; // 2 * (length + width) * quantity
  actual_m2: number; // length * width * quantity
  processing_fee: number; // perimeter_md * grinding_unit_price + holes * hole_unit_price + corners * corner_unit_price
}

export interface ComboItem {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
}

export interface Product {
  id: string;
  sku: string; // e.g. SP000001
  barcode?: string;
  name: string;
  category: string;
  unit: string; // m², cây, cái, bộ, mét dài
  product_type: ProductType;
  retail_price: number;
  trade_price?: number;
  import_price: number;
  avg_cost: number;
  stock_quantity: number;
  min_stock?: number;
  waste_factor?: number; // Hệ số hao hụt phôi (%), e.g., 5%
  default_grinding_price?: number;
  combo_items?: ComboItem[]; // for combo items
  image?: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  product_type: ProductType;
  unit: string;
  unit_price: number;
  quantity: number; // tổng m2 nếu là hàng area, hoặc số cái
  discount_amount: number;
  processing_fee: number; // Tổng phí gia công mài, khoét lỗ từ dimension_details
  subtotal: number; // (quantity * unit_price) + processing_fee - discount_amount
  dimension_details?: DimensionDetail[]; // JSONB dimension_details
  waste_factor?: number;
  material_consumed?: number; // quantity * (1 + waste_factor/100)
}

export interface PaymentItem {
  method: 'cash' | 'transfer' | 'card' | 'debt';
  amount: number;
  reference?: string;
}

export type OrderStatus = 'pending' | 'deposit_order' | 'completed' | 'cancelled' | 'returned';

export interface Order {
  id: string;
  server_id?: string; // UUID đơn trên server (có khi checkout online — dùng cho cancel/return)
  client_uuid?: string; // Idempotency key gửi server 0029 — stable qua retry/replay
  order_code: string; // HD-YYMMDD-XXXX
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  items: OrderItem[];
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  shipping_fee: number;
  tendered_amount?: number; // Tiền khách đưa lúc checkout (để replay offline gửi đúng; đơn cũ không có)
  vat_amount?: number; // VAT bill — server 0023 tính riêng (đơn cũ: gộp trong total, = 0/undefined)
  vat_percent?: number; // % VAT lúc bán (0 | 8 | 10)
  cash_rounding: number; // Chỉ tính khi có 'cash'
  total_amount: number; // subtotal + shipping_fee - discount_amount - cash_rounding
  paid_amount: number;
  debt_amount: number;
  change_amount: number;
  payments: PaymentItem[];
  status: OrderStatus;
  note?: string;
  created_at: string;
  cashier_name: string;
  branch_name: string;
  is_offline?: boolean;
}

export interface Customer {
  id: string;
  code: string; // KH0001
  name: string;
  phone: string;
  address?: string;
  group: 'retail' | 'contractor' | 'wholesale';
  current_debt: number;
  debt_limit: number;
  created_at: string;
}

export interface Supplier {
  id: string;
  code: string; // NCC0001
  name: string;
  phone: string;
  address?: string;
  tax_code?: string;
  credit_limit?: number;
  current_debt: number;
}

export interface PurchaseOrder {
  id: string;
  code: string; // NH-YYMMDD-XXXX
  supplier_id: string;
  supplier_name: string;
  items: {
    product_id: string;
    sku: string;
    name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  debt_amount: number;
  status: 'completed' | 'cancelled';
  created_at: string;
}

export type ProjectPhase = 1 | 2 | 3 | 4; 
// 1: Báo giá dự toán -> 2: Xuất kho vật tư -> 3: Chấm công thợ -> 4: Quyết toán & P&L

export interface ProjectMaterial {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
}

export interface ProjectWorker {
  id: string;
  worker_name: string;
  role: string;
  days_worked: number;
  daily_wage: number;
  allowance: number;
  total_wage: number;
}

export interface Project {
  id: string;
  code: string; // CT-YYMMDD-XXXX
  name: string;
  customer_id: string;
  customer_name: string;
  address: string;
  phase: ProjectPhase;
  estimated_revenue: number;
  settled_revenue: number;
  materials: ProjectMaterial[];
  workers: ProjectWorker[];
  other_costs: number;
  material_cost_total: number;
  labor_cost_total: number;
  total_cost: number;
  actual_profit: number; // settled_revenue - total_cost
  status: 'planning' | 'in_progress' | 'completed';
  created_at: string;
}

export interface CashbookEntry {
  id: string;
  code: string; // PQ-YYMMDD-XXXX hoặc PT/PC
  type: 'receipt' | 'expense';
  fund_type: 'cash' | 'bank';
  category: 'sales' | 'deposit' | 'debt_collection' | 'supplier_payment' | 'labor' | 'material' | 'advance' | 'other';
  amount: number;
  reference_order_code?: string;
  partner_name?: string;
  note: string;
  created_at: string;
}

export interface Shift {
  id: string;
  cashier_name: string;
  opened_at: string;
  closed_at?: string;
  starting_cash: number;
  status: 'open' | 'closed';
  cash_sales: number;
  transfer_sales: number;
  deposit_collected: number;
  cash_payouts: number;
  expected_cash: number;
  counted_cash?: number;
  cash_difference?: number;
  order_count: number;
}

export interface StockMovement {
  id: string;
  reference_code: string;
  product_id: string;
  product_name: string;
  movement_type: 'import' | 'export_sales' | 'export_project' | 'return';
  quantity: number;
  previous_stock: number;
  new_stock: number;
  note: string;
  created_at: string;
}

// HRM rebuild — mọi định nghĩa nhân sự/chấm công/phép/lương sống ở ./hrm (single source of truth).
// File này chỉ re-export để code cũ (nếu còn) không gãy import.
import type { AttendanceStatus } from './hrm';
export type { AttendanceStatus, Employee, SalaryType } from './hrm';
export { HR_POLICY, ATTENDANCE_STATUS_META, ATTENDANCE_STATUS_ORDER } from './hrm';

export type { AttendanceDay } from './hrm';
export { dailyEmployeeDayPay as attendanceDayPay, otPay as attendanceOtPay } from './hrm';

export type { PayrollStatus, PayrollRun, PayrollItem } from './hrm';
export { payrollItemNet, monthlyEmployeePay, buildPayrollItem } from './hrm';

// Input chấm 1 ô công ngày (điểm danh P/½/PL/KL/L + giờ TC + ghi chú)
export interface MarkDayInput {
  employee_id: string;
  work_date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  ot_hours?: number;
  note?: string;
}

export type ActiveScreen =
  | 'pos'
  | 'orders'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'projects'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'hr'
  | 'cashbook'
  | 'reports'
  | 'settings';
