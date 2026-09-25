'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Product,
  Customer,
  Supplier,
  Order,
  OrderItem,
  Project,
  CashbookEntry,
  Shift,
  ActiveScreen,
  PaymentItem,
  DimensionDetail,
  StockMovement,
  MarkDayInput,
} from './types';
import {
  Employee,
  AttendanceDay,
  AttendanceStatus,
  PayrollRun,
  PayrollItem,
  SalaryAdvance,
  buildPayrollItem,
  nextEmployeeCode,
  employeeLoginEmail,
  normalizeLoginId,
} from './hrm';
import {
  GRINDING_TYPES,
} from './mock-data';
import type { VietqrConfig } from './vietqr';
import {
  db,
  generateOrderCode,
  generateMasterCode,
  recomputeOrderItem,
  initializeDatabase,
} from './db';
import { AuthProvider, useAuth } from './store/auth';
import { CommerceProvider, useCommerce } from './store/commerce';
import { CatalogProvider, useCatalog } from './store/catalog';
import { NetworkProvider, useNetwork } from './store/network';
import { TransactionsProvider, useTransactions } from './store/transactions';
import { HrmProvider, useHrm } from './store/hrm-slice';
import type { User } from '@supabase/supabase-js';
import { vietnamizeError } from './error-vi';

// P3: domain modules — types giỏ/NV (./store/types), shop/in (./store/shop),
// tab mặc định (./store/cart), payload RPC (./store/rpc), chuẩn hóa NV (./store/staff).
// Re-export để import cũ từ '@/lib/store' không gãy.
import type { CartTab, EmployeeInput, HrmAccount, RestockLine, ReturnSkipped, ReturnResult } from './store/types';
import {
  DEFAULT_SHOP,
  PRINT_TEMPLATES,
  normalizePrintTemplate,
  normalizePrinterWidth,
} from './store/shop';
import type {
  ShopSettings,
  GrindingService,
  PrintTemplate,
  PrinterWidth,
  ReceiptFontSize,
  LegacyPrintTemplate,
} from './store/shop';
import { DEFAULT_TAB } from './store/cart';
import { toRpcItems } from './store/rpc';
import { employeeCols } from './store/staff';
export type { CartTab, EmployeeInput, HrmAccount, RestockLine, ReturnSkipped, ReturnResult } from './store/types';
export type {
  ShopSettings,
  GrindingService,
  PrintTemplate,
  PrinterWidth,
  ReceiptFontSize,
  LegacyPrintTemplate,
} from './store/shop';
export {
  DEFAULT_SHOP,
  PRINT_TEMPLATES,
  normalizePrintTemplate,
  normalizePrinterWidth,
} from './store/shop';
export { DEFAULT_TAB } from './store/cart';
export { toRpcItems } from './store/rpc';

interface StoreContextType {
  // Screens & Navigation
  currentScreen: ActiveScreen;
  setCurrentScreen: (screen: ActiveScreen) => void;
  flyoutMenuOpen: boolean;
  setFlyoutMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;

  // Master Data
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  orders: Order[];
  projects: Project[];
  cashbook: CashbookEntry[];
  currentShift: Shift;
  stockMovements: StockMovement[];
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  cashierName: string;

  // Network & Offline (PWA)
  isOnline: boolean;
  pendingQueue: Order[];
  syncPendingOrders: () => Promise<void>;
  // P3: Supabase Source of Truth
  catalogSource: 'local' | 'server';
  supabaseReady: boolean;
  refreshCatalog: () => Promise<boolean>;
  // P6/Auth + 0009: map id KH local -> uuid server (link công nợ server)
  customerMap: Record<string, string>;
  syncCustomers: () => Promise<Record<string, string>>;
  // Đồng bộ kéo đa máy: expose pull + trạng thái để badge/nút Làm mới ở header
  // (trước đây refreshServer* nằm ngoài type nên màn hình không gọi được).
  refreshServerOrders: () => Promise<boolean>;
  refreshServerCashbook: () => Promise<boolean>;
  refreshServerStockMovements: () => Promise<boolean>;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  isSyncing: boolean;
  refreshNow: () => Promise<boolean>;
  // Realtime đa máy (0049): true khi channel 'multipos-live' đã SUBSCRIBED
  realtimeLive: boolean;
  // Thương mại: cấu hình cửa hàng, VietQR, giá mài, làm tròn
  shop: ShopSettings;
  updateShop: (patch: Partial<ShopSettings>) => void;
  saveShopSettings: () => Promise<string | null>;
  vietqr: VietqrConfig;
  updateVietqr: (patch: Partial<VietqrConfig>) => void;
  saveVietqrSettings: () => Promise<string | null>;
  refreshVietqr: () => Promise<boolean>;
  grindingServices: GrindingService[];
  refreshGrinding: () => Promise<boolean>;
  updateGrindingPrice: (id: string, price: number) => Promise<string | null>;
  cashRounding: number;
  refreshCashRounding: () => Promise<boolean>;
  updateCashRounding: (denominator: number) => Promise<string | null>;
  // P6: Auth (Supabase Auth + profiles)
  user: User | null;
  profile: { full_name: string; role: string } | null;
  authReady: boolean;
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
  signIn: (loginId: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  // POS State
  posMode: 'standard' | 'fast'; // F2 toggle
  setPosMode: (mode: 'standard' | 'fast' | ((prev: 'standard' | 'fast') => 'standard' | 'fast')) => void;
  posFlow: 'sale' | 'import'; // Luồng POS: bán hàng hoặc nhập hàng (giỏ riêng, commit riêng)
  setPosFlow: (flow: 'sale' | 'import' | ((prev: 'sale' | 'import') => 'sale' | 'import')) => void;
  cartTabs: CartTab[];
  activeTabId: string;
  setActiveTabId: (tabId: string) => void;
  createCartTab: () => void;
  closeCartTab: (tabId: string) => void;
  updateActiveTab: (updater: Partial<CartTab> | ((prev: CartTab) => CartTab)) => void;
  switchPriceBook: (priceBook: 'retail' | 'trade') => void;

  // Cart item manipulation
  activeCart: CartTab;
  addItemToCart: (product: Product, quantity?: number, dimensionDetails?: DimensionDetail[], priceOverride?: number) => void;
  updateCartItem: (itemId: string, updates: Partial<OrderItem>) => void;
  removeCartItem: (itemId: string) => void;
  clearActiveCart: () => void;

  // Modals
  dimensionModalItem: { item: OrderItem; isNew?: boolean } | null;
  setDimensionModalItem: (item: { item: OrderItem; isNew?: boolean } | null) => void;
  receiptModalOrder: Order | null;
  setReceiptModalOrder: (order: Order | null) => void;
  shiftModalOpen: boolean;
  setShiftModalOpen: (open: boolean) => void;

  // Calculations & Actions
  calculatedTotals: {
    subtotal: number;
    discount_amount: number;
    shipping_fee: number;
    vat_amount: number;
    vat_percent: number;
    cash_rounding: number;
    payable: number;
    change_amount: number;
    debt_amount: number;
  };
  checkoutActiveOrder: (isDeposit?: boolean) => Promise<Order | null>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  returnOrder: (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]) => Promise<ReturnResult>;
  collectDebt: (customerId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  syncDebtsFromServer: () => Promise<{ updated: number; skipped: number }>;

  // Master Data Mutators
  addProduct: (product: Omit<Product, 'id' | 'sku'> & { sku?: string }) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addCustomer: (customer: Omit<Customer, 'id' | 'code' | 'created_at'> & { created_at?: string }) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  addSupplier: (supplier: Omit<Supplier, 'id' | 'code'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  paySupplierDebt: (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  addProject: (project: Omit<Project, 'id' | 'code'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  exportProjectMaterial: (projectId: string, productId: string, quantity: number) => Promise<Project | null>;
  exportProjectMaterialBatch: (
    projectId: string,
    lines: { productId: string; quantity: number }[]
  ) => Promise<Project | null>;
  addProjectWorker: (
    projectId: string,
    worker: { worker_name: string; role: string; days_worked: number; daily_wage: number; allowance: number; employee_id?: string; employee_code?: string }
  ) => Promise<Project | null>;
  removeProjectLine: (projectId: string, kind: 'material' | 'worker', lineKey: string) => Promise<Project | null>;
  updateProjectFinance: (
    projectId: string,
    finance: { estimated_revenue?: number; settled_revenue?: number; other_costs?: number }
  ) => Promise<Project | null>;
  collectProjectDeposit: (
    projectId: string,
    amount: number,
    paymentMethod: 'cash' | 'transfer'
  ) => Promise<Project | null>;
  refreshServerProjects: () => Promise<boolean>;
  syncProjects: () => Promise<void>;
  syncPendingOps: (retryFailed?: boolean) => Promise<{ synced: number; failed: number }>;
  closeShift: (countedCash: number) => Promise<boolean>;
  openNewShift: (startingCash: number) => Promise<void>;
  addCashbookEntry: (entry: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>) => Promise<boolean>;
  importStock: (productId: string, quantity: number, importPrice: number, supplierName?: string, note?: string) => Promise<void>;
  importStockBatch: (
    lines: { productId: string; quantity: number; importPrice: number }[],
    supplierName?: string,
    note?: string,
    paymentOptions?: {
      paymentMethod?: 'cash' | 'transfer' | 'debt' | 'partial';
      paidAmount?: number;
      supplierId?: string;
    }
  ) => Promise<boolean>;
  // HRM rebuild (gọn): employees master + điểm danh ngày + phép + lương
  hrmLoading: boolean;
  hrmError: string | null;
  refreshHrm: () => Promise<void>;
  accounts: HrmAccount[];
  saveEmployee: (input: EmployeeInput) => Promise<boolean>;
  createEmployeeWithAccount: (
    emp: EmployeeInput,
    acct: { password: string; role: string }
  ) => Promise<boolean>;
  createAccountForEmployee: (employeeId: string, acct: { password: string; role: string }) => Promise<boolean>;
  resetEmployeePassword: (employeeId: string, newPassword: string) => Promise<boolean>;
  setEmployeeStatus: (id: string, status: 'active' | 'inactive') => Promise<boolean>;
  markDay: (input: MarkDayInput) => Promise<boolean>;
  clearDay: (id: string) => Promise<boolean>;
  payrollLocks: string[]; // các tháng YYYY-MM đã chốt (khóa chấm)
  setMonthLock: (month: string, locked: boolean) => Promise<boolean>;
  payrollRuns: PayrollRun[];
  payrollItems: PayrollItem[];
  advances: SalaryAdvance[];
  addAdvance: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; advance_date: string; note?: string }) => Promise<boolean>;
  deleteAdvance: (id: string) => Promise<boolean>;
  // Lập phiếu chi tay ở Sổ quỹ (hạng mục Tạm ứng) + link vào bảng lương
  addAdvanceVoucher: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; note?: string }) => Promise<boolean>;
  payrollStaleMonths: string[]; // tháng có bảng nháp nhưng công/ứng đổi sau khi lập -> cần Tạo lại
  generatePayroll: (month: string) => Promise<boolean>;
  lockMonth: (month: string) => Promise<boolean>;
  reopenPayroll: (runId: string) => Promise<boolean>;
  payPayroll: (runId: string, fund: 'cash' | 'bank') => Promise<boolean>;
  resetData: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

// Realtime đa máy (0049): gom event thay đổi rồi refresh 1 lần để đợt checkout
// dồn dập (N dòng items + receipt + trừ kho) không spam server.
const REALTIME_DEBOUNCE_MS = 800;

// P3-phần 2: StoreInner giữ toàn bộ state nghiệp vụ còn lại; Auth + Commerce sống ở
// providers riêng (./store/auth, ./store/commerce) và được consume ở đây. API useStore()
// giữ nguyên nên mọi màn hình không đổi.
function StoreInner({ children }: { children: React.ReactNode }) {
  const {
    supa,
    user,
    profile,
    supabaseReady,
    authReady,
    loginOpen,
    setLoginOpen,
    signIn,
    signOut,
  } = useAuth();
  const {
    shop,
    updateShop,
    saveShopSettings,
    vietqr,
    updateVietqr,
    saveVietqrSettings,
    refreshVietqr,
    grindingServices,
    refreshGrinding,
    updateGrindingPrice,
    cashRounding,
    refreshCashRounding,
    updateCashRounding,
  } = useCommerce();
  const {
    products,
    setProducts,
    suppliers,
    setSuppliers,
    customers,
    setCustomers,
    customerMap,
    catalogSource,
    refreshCatalog,
    syncMasterData,
    syncCustomers,
    addProduct,
    updateProduct,
    deleteProduct,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addSupplier,
    updateSupplier,
    deleteSupplier,
  } = useCatalog();

  // Navigation
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('multipos_last_screen');
      if (saved) return saved as ActiveScreen;
    }
    return 'pos';
  });
  const [flyoutMenuOpen, setFlyoutMenuOpen] = useState<boolean>(false);

  // State nghiệp vụ còn lại ở StoreInner: điều hướng + khởi tạo DB + facade. Master data ở Catalog, tiền/kho/POS ở Transactions, nhân sự ở Hrm.

  // Network (isOnline/toggle) sống ở NetworkProvider; state tiền/kho/POS sống ở TransactionsProvider.
  const { isOnline } = useNetwork();
  const {
    employees,
    attendanceDays,
    setEmployees,
    setAttendanceDays,
    setPayrollLocks,
    setPayrollRuns,
    setPayrollItems,
    setAdvances,
    setPayrollStaleMonths,
    setAccounts,
    setHrmError,
    hrmLoading,
    hrmError,
    refreshHrm,
    accounts,
    saveEmployee,
    setEmployeeStatus,
    createEmployeeWithAccount,
    createAccountForEmployee,
    resetEmployeePassword,
    markDay,
    clearDay,
    payrollLocks,
    setMonthLock,
    payrollRuns,
    payrollItems,
    advances,
    addAdvance,
    deleteAdvance,
    addAdvanceVoucher,
    payrollStaleMonths,
    generatePayroll,
    lockMonth,
    reopenPayroll,
    payPayroll,
  } = useHrm();
  const {
    orders,
    setOrders,
    projects,
    setProjects,
    cashbook,
    setCashbook,
    currentShift,
    setCurrentShift,
    stockMovements,
    setStockMovements,
    pendingQueue,
    setPendingQueue,
    cashierName,
    posMode,
    setPosMode,
    posFlow,
    setPosFlow,
    cartTabs,
    activeTabId,
    setActiveTabId,
    createCartTab,
    closeCartTab,
    updateActiveTab,
    switchPriceBook,
    activeCart,
    addItemToCart,
    updateCartItem,
    removeCartItem,
    clearActiveCart,
    dimensionModalItem,
    setDimensionModalItem,
    receiptModalOrder,
    setReceiptModalOrder,
    shiftModalOpen,
    setShiftModalOpen,
    calculatedTotals,
    checkoutActiveOrder,
    refreshServerOrders,
    refreshServerStockMovements,
    refreshServerCashbook,
    syncPendingOrders,
    resolveServerOrderId,
    cancelOrder,
    returnOrder,
    collectDebt,
    syncDebtsFromServer,
    paySupplierDebt,
    addProject,
    updateProject,
    exportProjectMaterial,
    exportProjectMaterialBatch,
    addProjectWorker,
    removeProjectLine,
    updateProjectFinance,
    collectProjectDeposit,
    refreshServerProjects,
    syncProjects,
    syncPendingOps,
    closeShift,
    openNewShift,
    refreshShiftFromServer,
    addCashbookEntry,
    importStock,
    importStockBatch,
  } = useTransactions();

  // Trạng thái đồng bộ kéo (badge header + nút Làm mới tay). Ghi nhận cả nhịp
  // tự động (15s/focus) lẫn bấm tay để máy báo cáo không "đứng hình câm".
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [localDataReady, setLocalDataReady] = useState(false);
  const refreshNow = useCallback(async (): Promise<boolean> => {
    if (!isOnline || !supabaseReady) {
      setLastSyncError(
        !isOnline ? 'Đang offline — chưa kéo được số liệu mới.' : 'Chưa kết nối Supabase.'
      );
      return false;
    }
    setIsSyncing(true);
    try {
      await syncMasterData();
      await syncPendingOps(true);
      const results = await Promise.all([
        refreshServerOrders(),
        refreshServerStockMovements(),
        refreshServerCashbook(),
        refreshCatalog(),
      ]);
      const ok = results.every(Boolean);
      if (ok) {
        setLastSyncAt(Date.now());
        setLastSyncError(null);
      } else {
        setLastSyncError('Một phần dữ liệu chưa đồng bộ — bấm Làm mới để thử lại.');
      }
      return ok;
    } catch (e: unknown) {
      setLastSyncError(e instanceof Error ? e.message : 'Lỗi đồng bộ.');
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, supabaseReady, refreshServerOrders, refreshServerStockMovements, refreshServerCashbook, refreshCatalog, syncMasterData, syncPendingOps]);

  // Realtime đa máy (0049): 1 channel 'multipos-live' nghe 10 bảng publication,
  // event nào cũng chỉ xếp hàng rồi debounce gọi lại đúng hàm refresh tương ứng
  // (tái dùng merge server-wins đã kiểm chứng). Poll 15s + focus giữ nguyên
  // làm lưới an toàn khi socket rớt.
  const [realtimeLive, setRealtimeLive] = useState(false);
  useEffect(() => {
    if (!isOnline || !supabaseReady || !supa || !user) {
      // Idiom chung của repo: microtask để tránh set-state-in-effect sync
      Promise.resolve().then(() => setRealtimeLive(false));
      return;
    }
    const TABLE_REFRESH: Record<string, (() => Promise<boolean>)[]> = {
      orders: [refreshServerOrders, refreshServerCashbook],
      order_items: [refreshServerOrders],
      cashbook_entries: [refreshServerCashbook],
      products: [refreshCatalog],
      customers: [refreshCatalog],
      suppliers: [refreshCatalog],
      combo_items: [refreshCatalog],
      stock_movements: [refreshServerStockMovements],
      purchase_orders: [refreshCatalog, refreshServerCashbook],
      shifts: [refreshShiftFromServer],
    };
    const queued = new Set<() => Promise<boolean>>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = async () => {
      timer = null;
      const fns = [...queued];
      queued.clear();
      if (fns.length === 0) return;
      const rs = await Promise.allSettled(fns.map((f) => f()));
      if (rs.every((r) => r.status === 'fulfilled' && r.value === true)) {
        setLastSyncAt(Date.now());
        setLastSyncError(null);
      }
    };
    const schedule = (table: string) => {
      (TABLE_REFRESH[table] || []).forEach((f) => queued.add(f));
      if (timer !== null) return;
      timer = setTimeout(() => {
        flush().catch(() => {});
      }, REALTIME_DEBOUNCE_MS);
    };
    const channel = supa.channel('multipos-live');
    for (const table of Object.keys(TABLE_REFRESH)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => schedule(table));
    }
    channel.subscribe((status) => {
      setRealtimeLive(status === 'SUBSCRIBED');
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      setRealtimeLive(false);
      supa.removeChannel(channel).catch(() => {});
    };
  }, [isOnline, supabaseReady, supa, user, refreshServerOrders, refreshServerCashbook, refreshServerStockMovements, refreshCatalog, refreshShiftFromServer]);



  // Initialize DB on mount
  useEffect(() => {
    initializeDatabase()
      .then(async () => {
      try {
        const storedProducts = await db.products.toArray();
        if (storedProducts.length > 0) setProducts(storedProducts);
        const storedCustomers = await db.customers.toArray();
        if (storedCustomers.length > 0) setCustomers(storedCustomers);
        const storedSuppliers = await db.suppliers.toArray();
        if (storedSuppliers.length > 0) setSuppliers(storedSuppliers);
        const storedOrders = await db.orders.toArray();
        if (storedOrders.length > 0) setOrders(storedOrders);
        const storedProjects = await db.projects.toArray();
        if (storedProjects.length > 0) setProjects(storedProjects);
        const storedCashbook = await db.cashbook.toArray();
        if (storedCashbook.length > 0) setCashbook(storedCashbook);
        const storedPending = await db.pendingOrders.toArray();
        setPendingQueue(storedPending);
        try {
          const [emps, days] = await Promise.all([
            db.employees.toArray().catch(() => [] as Employee[]),
            db.attendanceDays.toArray().catch(() => [] as AttendanceDay[]),
          ]);
          if (emps.length > 0) setEmployees(emps);
          if (days.length > 0) setAttendanceDays(days);
          try {
            localStorage.removeItem('multipos_staff_cache_v1');
          } catch {
            /* best-effort */
          }
        } catch {
          /* máy trạm chưa nâng Dexie v4 -> bỏ qua, lần ghi đầu sẽ tạo bảng */
        }
      } catch (err) {
        console.warn('DB load error:', err);
      }
    })
      .catch((err) => {
        console.warn('DB initialize error:', err);
      })
      .finally(() => setLocalDataReady(true));
  }, [setCustomers, setProducts, setSuppliers, setCashbook, setOrders, setPendingQueue, setProjects, setAttendanceDays, setEmployees]);


  // P3: có mạng -> kéo catalog từ server (re-sync tồn/giá khi vừa online lại)
  // 0009: đồng thời đẩy master KH lên server để link công nợ (bỏ qua khách lẻ + đã map)
  // Thương mại: kéo giá mài + làm tròn server
  // (chạy trong microtask để tránh set-state-in-effect)
  useEffect(() => {
    if (isOnline && localDataReady) {
      Promise.resolve()
        .then(async () => {
          const masterResult = await syncMasterData();
          if (masterResult.failed === 0) await refreshCatalog();
          await syncPendingOrders();
          await syncPendingOps();
          await Promise.allSettled([
            refreshServerOrders(),
            refreshServerStockMovements(),
            refreshServerCashbook(),
            syncCustomers(),
            syncProjects(),
            refreshGrinding(),
            refreshCashRounding(),
          ]);
        })
        .catch(() => {});
    }
  }, [isOnline, localDataReady, user, pendingQueue.length, syncPendingOrders, syncMasterData, refreshCatalog, refreshServerOrders, refreshServerStockMovements, refreshServerCashbook, syncCustomers, syncProjects, syncPendingOps, refreshGrinding, refreshCashRounding]);

  useEffect(() => {
    if (!isOnline || !supabaseReady) return;
    const refresh = () => {
      // Ghi nhận kết quả nhịp tự động để badge header phản ánh đúng (đủ/thiếu).
      // Không đè lỗi của lần bấm tay đang chạy dở.
      Promise.allSettled([
        refreshServerOrders(),
        refreshServerStockMovements(),
        refreshServerCashbook(),
        refreshCatalog(),
      ]).then((rs) => {
        if (rs.every((r) => r.status === 'fulfilled' && r.value === true)) {
          setLastSyncAt(Date.now());
          setLastSyncError(null);
        } else if (!isSyncing) {
          setLastSyncError('Tự động đồng bộ thiếu một phần — bấm Làm mới để thử lại.');
        }
      });
    };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isOnline, supabaseReady, isSyncing, refreshServerOrders, refreshServerStockMovements, refreshServerCashbook, refreshCatalog]);

  // Active Cart Tab


  const resetData = useCallback(async () => {
    try {
      await db.products.clear();
      await db.customers.clear();
      await db.suppliers.clear();
      await db.orders.clear();
      await db.projects.clear();
      await db.cashbook.clear();
      await db.shifts.clear();
      await db.pendingOrders.clear();
      await db.employees.clear().catch(() => {});
      await db.attendanceDays.clear().catch(() => {});

      setProducts([]);
      setCustomers([]);
      setSuppliers([]);
      setOrders([]);
      setProjects([]);
      setCashbook([]);
      setCurrentShift({
        id: 'shift-empty',
        cashier_name: 'Chưa mở ca',
        opened_at: '',
        starting_cash: 0,
        status: 'closed',
        cash_sales: 0,
        transfer_sales: 0,
        deposit_collected: 0,
        cash_payouts: 0,
        expected_cash: 0,
        order_count: 0,
      });
      setStockMovements([]);
      setEmployees([]);
      setAttendanceDays([]);
      setAdvances([]);
      setPayrollStaleMonths([]);
      setPayrollRuns([]);
      setPayrollItems([]);
      setPayrollLocks([]);
      setAccounts([]);
      setHrmError(null);
      setPendingQueue([]);
    } catch (err) {
      console.warn('Reset data error:', err);
    }
  }, [setCustomers, setProducts, setSuppliers, setCashbook, setCurrentShift, setOrders, setPendingQueue, setProjects, setStockMovements, setAccounts, setAdvances, setAttendanceDays, setEmployees, setHrmError, setPayrollItems, setPayrollLocks, setPayrollRuns, setPayrollStaleMonths]);

  const setCurrentScreenWithPersist = useCallback((screen: ActiveScreen | ((prev: ActiveScreen) => ActiveScreen)) => {
    setCurrentScreen((prev) => {
      const next = typeof screen === 'function' ? screen(prev) : screen;
      if (typeof window !== 'undefined') {
        localStorage.setItem('multipos_last_screen', next);
      }
      return next;
    });
  }, []);

  const value = {
    currentScreen,
    setCurrentScreen: setCurrentScreenWithPersist,
    flyoutMenuOpen,
    setFlyoutMenuOpen,
    products,
    customers,
    suppliers,
    orders,
    projects,
    cashbook,
    currentShift,
    stockMovements,
    employees,
    attendanceDays,
    hrmLoading,
    hrmError,
    accounts,
    refreshHrm,
    saveEmployee,
    setEmployeeStatus,
    createEmployeeWithAccount,
    createAccountForEmployee,
    resetEmployeePassword,
    markDay,
    clearDay,
    payrollLocks,
    setMonthLock,
    payrollRuns,
    payrollItems,
    advances,
    addAdvance,
    deleteAdvance,
    addAdvanceVoucher,
    payrollStaleMonths,
    generatePayroll,
    lockMonth,
    reopenPayroll,
    payPayroll,
    cashierName,
    isOnline,
    pendingQueue,
    syncPendingOrders,
    lastSyncAt,
    lastSyncError,
    isSyncing,
    refreshNow,
    realtimeLive,
    catalogSource,
    supabaseReady,
    refreshCatalog,
    customerMap,
    syncCustomers,
    shop,
    updateShop,
    saveShopSettings,
    vietqr,
    updateVietqr,
    saveVietqrSettings,
    refreshVietqr,
    grindingServices,
    refreshGrinding,
    updateGrindingPrice,
    cashRounding,
    refreshCashRounding,
    updateCashRounding,
    user,
    profile,
    authReady,
    loginOpen,
    setLoginOpen,
    signIn,
    signOut,
    posMode,
    setPosMode,
    posFlow,
    setPosFlow,
    cartTabs,
    activeTabId,
    setActiveTabId,
    createCartTab,
    closeCartTab,
    updateActiveTab,
    switchPriceBook,
    activeCart,
    addItemToCart,
    updateCartItem,
    removeCartItem,
    clearActiveCart,
    dimensionModalItem,
    setDimensionModalItem,
    receiptModalOrder,
    setReceiptModalOrder,
    shiftModalOpen,
    setShiftModalOpen,
    calculatedTotals,
    checkoutActiveOrder,
    refreshServerOrders,
    refreshServerCashbook,
    refreshServerStockMovements,
    cancelOrder,
    returnOrder,
    collectDebt,
    syncDebtsFromServer,
    addProduct,
    updateProduct,
    deleteProduct,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    paySupplierDebt,
    addProject,
    updateProject,
    exportProjectMaterial,
    exportProjectMaterialBatch,
    addProjectWorker,
    removeProjectLine,
    updateProjectFinance,
    collectProjectDeposit,
    refreshServerProjects,
    syncProjects,
    syncPendingOps,
    closeShift,
    openNewShift,
    addCashbookEntry,
    importStock,
    importStockBatch,
    resetData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// Composer giữ tên + API cũ: Auth > Commerce > Catalog > Network > nghiệp vụ còn lại.
export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CommerceProvider>
        <NetworkProvider>
          <CatalogProvider>
            <TransactionsProvider>
              <HrmProvider>
                <StoreInner>{children}</StoreInner>
              </HrmProvider>
            </TransactionsProvider>
          </CatalogProvider>
        </NetworkProvider>
      </CommerceProvider>
    </AuthProvider>
  );
}

export function useStore(): StoreContextType {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}
