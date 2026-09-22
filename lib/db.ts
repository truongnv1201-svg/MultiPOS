import Dexie, { type Table } from 'dexie';
import {
  Product,
  Customer,
  Supplier,
  Order,
  Project,
  CashbookEntry,
  Shift,
  PurchaseOrder,
  OrderItem,
  DimensionDetail,
} from './types';
import type { Employee, AttendanceDay } from './hrm';

export interface PendingMasterData {
  id: string;
  entity: 'product' | 'customer' | 'supplier';
  operation: 'insert' | 'update';
  local_id: string;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
  status: 'pending' | 'failed';
  last_error?: string;
}

export class MultiPOSDatabase extends Dexie {
  products!: Table<Product, string>;
  customers!: Table<Customer, string>;
  suppliers!: Table<Supplier, string>;
  orders!: Table<Order, string>;
  projects!: Table<Project, string>;
  cashbook!: Table<CashbookEntry, string>;
  shifts!: Table<Shift, string>;
  purchaseOrders!: Table<PurchaseOrder, string>;
  pendingOrders!: Table<Order, string>; // Offline pending queue (OFF-ERR-01)
  employees!: Table<Employee, string>; // HRM: master nhân sự
  attendanceDays!: Table<AttendanceDay, string>; // HRM: công ngày
  pendingMasterData!: Table<PendingMasterData, string>;

  constructor() {
    super('MultiPOSDB_v213');
    this.version(1).stores({
      products: 'id, sku, barcode, name, category, product_type',
      customers: 'id, code, name, phone, group',
      suppliers: 'id, code, name, phone',
      orders: 'id, order_code, customer_id, status, created_at',
      projects: 'id, code, customer_id, phase, status',
      cashbook: 'id, code, type, fund_type, category, created_at',
      shifts: 'id, status, opened_at',
      purchaseOrders: 'id, code, supplier_id, created_at',
      pendingOrders: 'id, order_code, created_at',
    });
    // v2: thêm bảng chấm công (nâng cấp cộng thêm, giữ nguyên dữ liệu cũ)
    this.version(2).stores({
      products: 'id, sku, barcode, name, category, product_type',
      customers: 'id, code, name, phone, group',
      suppliers: 'id, code, name, phone',
      orders: 'id, order_code, customer_id, status, created_at',
      projects: 'id, code, customer_id, phase, status',
      cashbook: 'id, code, type, fund_type, category, created_at',
      shifts: 'id, status, opened_at',
      purchaseOrders: 'id, code, supplier_id, created_at',
      pendingOrders: 'id, order_code, created_at',
      attendance: 'id, project_id, worker_name, work_date',
    });
    // v3: thêm bảng đơn từ (nghỉ phép / tăng ca / đi muộn)
    this.version(3).stores({
      products: 'id, sku, barcode, name, category, product_type',
      customers: 'id, code, name, phone, group',
      suppliers: 'id, code, name, phone',
      orders: 'id, order_code, customer_id, status, created_at',
      projects: 'id, code, customer_id, phase, status',
      cashbook: 'id, code, type, fund_type, category, created_at',
      shifts: 'id, status, opened_at',
      purchaseOrders: 'id, code, supplier_id, created_at',
      pendingOrders: 'id, order_code, created_at',
      attendance: 'id, project_id, worker_name, work_date',
      leaveRequests: 'id, user_id, status, date_from',
    });
    // v4: HRM rebuild — bảng nhân sự/công/đơn mới (giữ bảng legacy để clear 1 lần)
    this.version(4).stores({
      products: 'id, sku, barcode, name, category, product_type',
      customers: 'id, code, name, phone, group',
      suppliers: 'id, code, name, phone',
      orders: 'id, order_code, customer_id, status, created_at',
      projects: 'id, code, customer_id, phase, status',
      cashbook: 'id, code, type, fund_type, category, created_at',
      shifts: 'id, status, opened_at',
      purchaseOrders: 'id, code, supplier_id, created_at',
      pendingOrders: 'id, order_code, created_at',
      attendance: 'id, project_id, worker_name, work_date',
      leaveRequests: 'id, user_id, status, date_from',
      employees: 'id, code, status, full_name',
      attendanceDays: 'id, employee_id, work_date',
    });
    // v5: bỏ hẳn đơn nghỉ phép — xóa bảng attendance/leaveRequests/hrmLeave legacy
    this.version(5).stores({
      products: 'id, sku, barcode, name, category, product_type',
      customers: 'id, code, name, phone, group',
      suppliers: 'id, code, name, phone',
      orders: 'id, order_code, customer_id, status, created_at',
      projects: 'id, code, customer_id, phase, status',
      cashbook: 'id, code, type, fund_type, category, created_at',
      shifts: 'id, status, opened_at',
      purchaseOrders: 'id, code, supplier_id, created_at',
      pendingOrders: 'id, order_code, created_at',
      employees: 'id, code, status, full_name',
      attendanceDays: 'id, employee_id, work_date',
    });
    // v6: hàng đợi master-data khi mất mạng (sản phẩm/KH/NCC)
    this.version(6).stores({
      pendingMasterData: 'id, entity, operation, status, created_at',
    });
  }
}

export const db = new MultiPOSDatabase();

// Sequence counters for codes
let orderSeq = 10;
let masterSeq = 12;
let cashSeq = 5;
let projectSeq = 2;

export function generateOrderCode(prefix: 'HD' | 'TH' | 'NH' | 'CT' | 'PQ' | 'PT' | 'PC'): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  orderSeq += 1;
  return `${prefix}-${yy}${mm}${dd}-${String(orderSeq).padStart(4, '0')}`;
}

export function generateMasterCode(prefix: string = 'SP', length: number = 6): string {
  masterSeq += 1;
  return `${prefix}${String(masterSeq).padStart(length, '0')}`;
}

// Toán tiền thuần sống ở ./pricing (single source, test được bằng node --test).
// Re-export để import cũ từ '@/lib/db' không gãy.
export { calculateDimensionRow, recomputeOrderItem } from './pricing';

// Local storage starts empty. Server data is loaded by the providers when available.
export async function initializeDatabase(): Promise<void> {
  await db.open();
}
