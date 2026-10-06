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
  /** @deprecated Đã bỏ Danh mục khỏi UI (dùng product_type). Server vẫn giữ cột với default 'Chung'. */
  category?: string;
  unit: string; // m², cây, cái, bộ, mét dài
  product_type: ProductType;
  retail_price: number;
  trade_price?: number;
  import_price: number;
  avg_cost: number;
  stock_quantity: number;
  min_stock?: number;
  /** Cho phép nhập số lượng thập phân khi bán/nhập (vd 2,15 kg). Mặc định false = số nguyên. */
  allow_decimal?: boolean;
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
  price_override?: boolean; // Quản lý/Admin đã sửa giá dòng này -> gửi kèm lên server (xem migration 0059)
}

export interface PaymentItem {
  // 'card' (quẹt thẻ) đã bỏ khỏi UI chọn (chỉ còn Tiền mặt/Chuyển khoản/Ghi nợ)
  // nhưng giữ trong type để đơn cũ vẫn đọc/hiển thị được.
  method: 'cash' | 'transfer' | 'card' | 'debt';
  amount: number;
  reference?: string;
}

export type OrderStatus = 'pending' | 'completed' | 'cancelled' | 'returned' | 'partial_returned';
// Đơn cọc bán hàng đã bỏ hẳn (dữ liệu test xóa sạch, không còn đơn cọc).

export interface Order {
  id: string;
  server_id?: string; // UUID đơn trên server (có khi checkout online — dùng cho cancel/return)
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
  total_amount: number; // subtotal + shipping_fee + vat_amount - discount_amount
  paid_amount: number;
  debt_amount: number;
  change_amount: number;
  payments: PaymentItem[];
  status: OrderStatus;
  note?: string;
  created_at: string;
  cashier_name: string;
  is_offline?: boolean;
  sync_attempts?: number;
  sync_last_error?: string;
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
  status: 'completed' | 'cancelled' | 'debt' | 'partial';
  /** Ghi chú phiếu nhập (số hóa đơn đỏ, xe giao...) — chỉ lưu local (server chưa có cột). */
  note?: string;
  created_at: string;
}

/**
 * Luồng của màn POS:
 * - sale   : bán hàng (tạo đơn, thu tiền, trừ kho qua pos_checkout)
 * - import : nhập kho (tăng kho, MAC, công nợ NCC, sổ quỹ — importStockBatch)
 * - project: xuất vật tư cho công trình (trừ kho + ghi vào project_materials để tính
 *            giá vốn vật tư của công trình — KHÔNG tạo đơn, KHÔNG đụng sổ quỹ)
 */
export type PosFlow = 'sale' | 'import' | 'project';

export interface ProjectMaterial {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  /** 0064: dòng này là HAO HỤT (điều chỉnh tồn) chứ không phải xuất vật tư bình thường.
   *  Vẫn cộng vào material_cost_total để lợi nhuận công trình giảm đúng, nhưng tồn kho
   *  KHÔNG bị trừ thêm (đã trừ trong adjust_stock). */
  is_adjust?: boolean;
  note?: string;
  created_at?: string;
}

export interface ProjectWorker {
  id: string;
  employee_id?: string; // link hồ sơ nhân sự (thợ ngoài để trống)
  employee_code?: string; // mã NV để hiển thị truy vết
  worker_name: string;
  role: string;
  days_worked: number;
  daily_wage: number;
  allowance: number;
  total_wage: number;
}

export interface Project {
  id: string;
  server_id?: string; // uuid server sau khi đẩy (giữ id local ổn định cho UI)
  code: string; // CT-YYMMDD-XXXX
  name: string;
  customer_id: string;
  customer_name: string;
  address: string;
  // 0065: bỏ hẳn phase/status — chỉ để hiển thị, không điều khiển nghiệp vụ nào
  // (không RPC nào gate/check; UI đã bỏ 3 tab giai đoạn là nơi duy nhất đổi phase).
  estimated_revenue: number;
  settled_revenue: number;
  deposit_amount?: number; // đã thu cọc/tạm ứng của chủ đầu tư (không trừ vào lãi)
  materials: ProjectMaterial[];
  workers: ProjectWorker[];
  other_costs: number;
  material_cost_total: number;
  labor_cost_total: number;
  total_cost: number;
  actual_profit: number; // settled_revenue - total_cost
  created_at: string;
}

export interface CashbookEntry {
  id: string;
  synced?: boolean; // đã đẩy lên server (voucher/import/suppay qua pendingOps)
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
  // 0064: server đã có cột movement_type thật (trước đây client đoán bằng regex trên note).
  // adjust_loss = điều chỉnh giảm (hao hụt), adjust_gain = điều chỉnh tăng (đếm thừa).
  movement_type: 'import' | 'export_sales' | 'export_project' | 'return' | 'adjust_loss' | 'adjust_gain';
  quantity: number;
  previous_stock: number;
  new_stock: number;
  note: string;
  created_at: string;
}

/**
 * 0064 — phiếu điều chỉnh tồn (hao hụt / đếm thừa).
 *
 * Vì sao cần: vật tư tồn lâu ngày hao mòn, nhưng trước 0064 KHÔNG có đường nào sửa
 * products.stock_quantity có kiểm soát (chỉ sửa được bằng cách import Excel ghi đè,
 * không ghi thẻ kho, không audit, không đụng avg_cost).
 */
export type StockAdjustReason =
  | 'damage'      // Hư/hỏng (vỡ, bể, dập)
  | 'expiry'      // Hết hạn dùng
  | 'lost'        // Thất lạc, mất
  | 'miscount'    // Đếm sai
  | 'cut_waste'   // Hao hụt khi cắt/ghép
  | 'other';

export const STOCK_ADJUST_REASON_LABEL: Record<StockAdjustReason, string> = {
  damage: 'Hư / hỏng',
  expiry: 'Hết hạn',
  lost: 'Thất lạc',
  miscount: 'Đếm sai',
  cut_waste: 'Hao hụt khi cắt / ghép',
  other: 'Khác',
};

export interface StockAdjustment {
  id: string;
  code: string;
  product_id: string;
  product_name: string;
  sku: string;
  previous_stock: number;
  counted_stock: number | null;
  delta: number;
  reason: StockAdjustReason;
  note: string;
  /** null = hao hụt tồn kho chung (chưa/biết thuộc công trình nào) */
  project_id: string | null;
  project_code: string;
  project_name: string;
  project_assigned_at: string | null;
  unit_cost: number;
  loss_amount: number;
  adjusted_by_name: string;
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
  | 'imports'
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
