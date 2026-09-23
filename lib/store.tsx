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

// P3: domain modules â€” types giá»/NV (./store/types), shop/in (./store/shop),
// tab máº·c Ä‘á»‹nh (./store/cart), payload RPC (./store/rpc), chuáº©n hÃ³a NV (./store/staff).
// Re-export Ä‘á»ƒ import cÅ© tá»« '@/lib/store' khÃ´ng gÃ£y.
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
  // P6/Auth + 0009: map id KH local -> uuid server (link cÃ´ng ná»£ server)
  customerMap: Record<string, string>;
  syncCustomers: () => Promise<Record<string, string>>;
  // ThÆ°Æ¡ng máº¡i: cáº¥u hÃ¬nh cá»­a hÃ ng, VietQR, giÃ¡ mÃ i, lÃ m trÃ²n
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
  posFlow: 'sale' | 'import'; // Luá»“ng POS: bÃ¡n hÃ ng hoáº·c nháº­p hÃ ng (giá» riÃªng, commit riÃªng)
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
  syncPendingOps: () => Promise<{ synced: number; failed: number }>;
  closeShift: (countedCash: number) => Promise<boolean>;
  openNewShift: (startingCash: number) => Promise<void>;
  addCashbookEntry: (entry: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>) => Promise<boolean>;
  importStock: (productId: string, quantity: number, importPrice: number, supplierName?: string, note?: string) => Promise<void>;
  importStockBatch: (
    lines: { productId: string; quantity: number; importPrice: number }[],
    supplierName?: string,
    note?: string
  ) => Promise<boolean>;
  // HRM rebuild (gá»n): employees master + Ä‘iá»ƒm danh ngÃ y + phÃ©p + lÆ°Æ¡ng
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
  payrollLocks: string[]; // cÃ¡c thÃ¡ng YYYY-MM Ä‘Ã£ chá»‘t (khÃ³a cháº¥m)
  setMonthLock: (month: string, locked: boolean) => Promise<boolean>;
  payrollRuns: PayrollRun[];
  payrollItems: PayrollItem[];
  advances: SalaryAdvance[];
  addAdvance: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; advance_date: string; note?: string }) => Promise<boolean>;
  deleteAdvance: (id: string) => Promise<boolean>;
  // Láº­p phiáº¿u chi tay á»Ÿ Sá»• quá»¹ (háº¡ng má»¥c Táº¡m á»©ng) + link vÃ o báº£ng lÆ°Æ¡ng
  addAdvanceVoucher: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; note?: string }) => Promise<boolean>;
  payrollStaleMonths: string[]; // thÃ¡ng cÃ³ báº£ng nhÃ¡p nhÆ°ng cÃ´ng/á»©ng Ä‘á»•i sau khi láº­p -> cáº§n Táº¡o láº¡i
  generatePayroll: (month: string) => Promise<boolean>;
  lockMonth: (month: string) => Promise<boolean>;
  reopenPayroll: (runId: string) => Promise<boolean>;
  payPayroll: (runId: string, fund: 'cash' | 'bank') => Promise<boolean>;
  resetData: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

// P3-pháº§n 2: StoreInner giá»¯ toÃ n bá»™ state nghiá»‡p vá»¥ cÃ²n láº¡i; Auth + Commerce sá»‘ng á»Ÿ
// providers riÃªng (./store/auth, ./store/commerce) vÃ  Ä‘Æ°á»£c consume á»Ÿ Ä‘Ã¢y. API useStore()
// giá»¯ nguyÃªn nÃªn má»i mÃ n hÃ¬nh khÃ´ng Ä‘á»•i.
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
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>('pos');
  const [flyoutMenuOpen, setFlyoutMenuOpen] = useState<boolean>(false);

  // State nghiá»‡p vá»¥ cÃ²n láº¡i á»Ÿ StoreInner: Ä‘iá»u hÆ°á»›ng + khá»Ÿi táº¡o DB + facade. Master data á»Ÿ Catalog, tiá»n/kho/POS á»Ÿ Transactions, nhÃ¢n sá»± á»Ÿ Hrm.

  // Network (isOnline/toggle) sá»‘ng á»Ÿ NetworkProvider; state tiá»n/kho/POS sá»‘ng á»Ÿ TransactionsProvider.
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



  // Initialize DB on mount
  useEffect(() => {
    initializeDatabase().then(async () => {
      try {
        const storedProducts = await db.products.toArray();
        if (storedProducts.length > 0) setProducts(storedProducts);
        const storedCustomers = await db.customers.toArray();
        if (storedCustomers.length > 0) setCustomers(storedCustomers);
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
          /* mÃ¡y tráº¡m chÆ°a nÃ¢ng Dexie v4 -> bá» qua, láº§n ghi Ä‘áº§u sáº½ táº¡o báº£ng */
        }
      } catch (err) {
        console.warn('DB load error:', err);
      }
    });
  }, [setCustomers, setProducts, setCashbook, setOrders, setPendingQueue, setProjects, setAttendanceDays, setEmployees]);


  // P3: cÃ³ máº¡ng -> kÃ©o catalog tá»« server (re-sync tá»“n/giÃ¡ khi vá»«a online láº¡i)
  // 0009: Ä‘á»“ng thá»i Ä‘áº©y master KH lÃªn server Ä‘á»ƒ link cÃ´ng ná»£ (bá» qua khÃ¡ch láº» + Ä‘Ã£ map)
  // ThÆ°Æ¡ng máº¡i: kÃ©o giÃ¡ mÃ i + lÃ m trÃ²n server
  // (cháº¡y trong microtask Ä‘á»ƒ trÃ¡nh set-state-in-effect)
  useEffect(() => {
    if (isOnline) {
      Promise.resolve().then(() => {
        syncPendingOrders().then(() => {
          syncMasterData().then(() => refreshCatalog());
          refreshServerOrders();
          refreshServerStockMovements();
          syncCustomers();
          syncProjects();
          syncPendingOps();
          refreshGrinding();
          refreshCashRounding();
        });
      });
    }
  }, [isOnline, user, pendingQueue.length, syncPendingOrders, syncMasterData, refreshCatalog, refreshServerOrders, refreshServerStockMovements, syncCustomers, syncProjects, syncPendingOps, refreshGrinding, refreshCashRounding]);

  useEffect(() => {
    if (!isOnline || !supabaseReady) return;
    const refresh = () => {
      refreshServerOrders();
      refreshServerStockMovements();
    };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isOnline, supabaseReady, refreshServerOrders, refreshServerStockMovements]);

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
        cashier_name: 'ChÆ°a má»Ÿ ca',
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

  const value = {
    currentScreen,
    setCurrentScreen,
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

// Composer giá»¯ tÃªn + API cÅ©: Auth > Commerce > Catalog > Network > nghiá»‡p vá»¥ cÃ²n láº¡i.
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

