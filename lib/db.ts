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
import {
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
  INITIAL_ORDERS,
  INITIAL_PROJECTS,
  INITIAL_CASHBOOK,
  INITIAL_SHIFT,
} from './mock-data';

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

  constructor() {
    super('MultiPOSDB_v212');
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
  }
}

export const db = new MultiPOSDatabase();

// Sequence counters for codes — P0: persist localStorage + fast-forward từ Dexie để
// reload/đa tab không sinh trùng mã (trước đây biến in-memory reset mỗi reload).
// Counter dùng chung mọi prefix chứng từ (giữ hành vi cũ), monotonic, không reset theo ngày.
const SEQ_KEY = 'multipos_seq_v1';
let orderSeq = 10;
let masterSeq = 12;
try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SEQ_KEY) : null;
  if (raw) {
    const saved = JSON.parse(raw) as { order?: unknown; master?: unknown };
    if (typeof saved.order === 'number') orderSeq = Math.max(10, Math.floor(saved.order));
    if (typeof saved.master === 'number') masterSeq = Math.max(12, Math.floor(saved.master));
  }
} catch {
  /* best-effort: SSR/không có localStorage */
}
function persistSeq(): void {
  try {
    localStorage.setItem(SEQ_KEY, JSON.stringify({ order: orderSeq, master: masterSeq }));
  } catch {
    /* best-effort */
  }
}
// Số đuôi của mã (HD-YYMMDD-XXXX -> XXXX, SP000012 -> 12) để fast-forward counter.
function trailingNum(code: string | undefined): number {
  if (!code) return 0;
  const m = code.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function generateOrderCode(prefix: 'HD' | 'TH' | 'NH' | 'CT' | 'PQ' | 'PT' | 'PC'): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  orderSeq += 1;
  persistSeq();
  return `${prefix}-${yy}${mm}${dd}-${String(orderSeq).padStart(4, '0')}`;
}

export function generateMasterCode(prefix: string = 'SP', length: number = 6): string {
  masterSeq += 1;
  persistSeq();
  return `${prefix}${String(masterSeq).padStart(length, '0')}`;
}

// Toán tiền thuần sống ở ./pricing (single source, test được bằng node --test).
// Re-export để import cũ từ '@/lib/db' không gãy.
export { calculateDimensionRow, recomputeOrderItem } from './pricing';

// Initialize seed data if empty
export async function initializeDatabase(): Promise<void> {
  try {
    const productCount = await db.products.count();
    if (productCount === 0) {
      await db.products.bulkAdd(INITIAL_PRODUCTS);
      await db.customers.bulkAdd(INITIAL_CUSTOMERS);
      await db.suppliers.bulkAdd(INITIAL_SUPPLIERS);
      await db.orders.bulkAdd(INITIAL_ORDERS);
      await db.projects.bulkAdd(INITIAL_PROJECTS);
      await db.cashbook.bulkAdd(INITIAL_CASHBOOK);
      await db.shifts.add(INITIAL_SHIFT);
    }
    // P0: fast-forward counter vượt mọi mã đã có (kể cả đơn server đã sync về máy) để
    // mã offline mới không bao giờ đụng mã cũ sau reload/xóa localStorage.
    const [orders, pending, cash, projects, products, customers, suppliers] = await Promise.all([
      db.orders.toArray().catch(() => []),
      db.pendingOrders.toArray().catch(() => []),
      db.cashbook.toArray().catch(() => []),
      db.projects.toArray().catch(() => []),
      db.products.toArray().catch(() => []),
      db.customers.toArray().catch(() => []),
      db.suppliers.toArray().catch(() => []),
    ]);
    let maxOrder = 0;
    for (const o of orders) maxOrder = Math.max(maxOrder, trailingNum(o.order_code));
    for (const o of pending) maxOrder = Math.max(maxOrder, trailingNum(o.order_code));
    for (const e of cash) maxOrder = Math.max(maxOrder, trailingNum(e.code));
    for (const p of projects) maxOrder = Math.max(maxOrder, trailingNum(p.code));
    if (maxOrder > orderSeq) {
      orderSeq = maxOrder;
      persistSeq();
    }
    let maxMaster = 0;
    for (const p of products) maxMaster = Math.max(maxMaster, trailingNum(p.sku));
    for (const c of customers) maxMaster = Math.max(maxMaster, trailingNum(c.code));
    for (const s of suppliers) maxMaster = Math.max(maxMaster, trailingNum(s.code));
    if (maxMaster > masterSeq) {
      masterSeq = maxMaster;
      persistSeq();
    }
  } catch (error) {
    console.warn('IndexedDB initial seed fallback:', error);
  }
}
