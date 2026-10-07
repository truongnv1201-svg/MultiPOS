// P3-tx composer (mỏng): gom các sub-hooks lib/store/tx/* thành TransactionsSlice.
// Giữ nguyên export API: TransactionsProvider, useTransactions, TransactionsSlice.
'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useAuth } from './auth';
import { useCommerce } from './commerce';
import { useTxCart } from './tx/cart';
import { useTxOrders } from './tx/orders';
import { useTxDebts } from './tx/debts';
import { useTxProjects } from './tx/projects';
import { useTxShiftStock } from './tx/shift-stock';
import type {
  Product,
  Order,
  OrderItem,
  Project,
  CashbookEntry,
  Shift,
  DimensionDetail,
  StockMovement,
  StockAdjustment,
  StockAdjustReason,
  PosFlow,
  PurchaseOrder,
} from '../types';
import type { CartTab, ReturnResult } from './types';

export interface TransactionsSlice {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  cashbook: CashbookEntry[];
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  currentShift: Shift;
  setCurrentShift: React.Dispatch<React.SetStateAction<Shift>>;
  stockMovements: StockMovement[];
  setStockMovements: React.Dispatch<React.SetStateAction<StockMovement[]>>;
  purchaseOrders: PurchaseOrder[];
  refreshPurchaseOrders: () => Promise<boolean>;
  refreshServerPurchaseOrders: () => Promise<boolean>;
  refreshServerStockMovements: (force?: boolean) => Promise<boolean>;
  refreshServerCashbook: () => Promise<boolean>;
  pendingQueue: Order[];
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
  cashierName: string;
  posFlow: PosFlow;
  setPosFlow: (flow: PosFlow) => void;
  posProjectId: string | null;
  setPosProjectId: (id: string | null) => void;
  cartTabs: CartTab[];
  activeTabId: string;
  setActiveTabId: (tabId: string) => void;
  createCartTab: () => void;
  closeCartTab: (tabId: string) => void;
  updateActiveTab: (updater: Partial<CartTab> | ((prev: CartTab) => CartTab)) => void;
  switchPriceBook: (priceBook: 'retail' | 'trade') => void;
  activeCart: CartTab;
  addItemToCart: (product: Product, quantity?: number, dimensionDetails?: DimensionDetail[], priceOverride?: number) => void;
  updateCartItem: (itemId: string, updates: Partial<OrderItem>) => void;
  removeCartItem: (itemId: string) => void;
  clearActiveCart: () => void;
  dimensionModalItem: { item: OrderItem; isNew?: boolean; onSave?: (item: OrderItem) => void } | null;
  setDimensionModalItem: (item: { item: OrderItem; isNew?: boolean; onSave?: (item: OrderItem) => void } | null) => void;
  receiptModalOrder: Order | null;
  setReceiptModalOrder: (order: Order | null) => void;
  shiftModalOpen: boolean;
  setShiftModalOpen: (open: boolean) => void;
  calculatedTotals: {
    subtotal: number;
    discount_amount: number;
    shipping_fee: number;
    vat_amount: number;
    vat_percent: number;
      payable: number;
    change_amount: number;
    debt_amount: number;
  };
  checkoutActiveOrder: () => Promise<Order | null>;
  refreshServerOrders: (force?: boolean) => Promise<boolean>;
  syncPendingOrders: () => Promise<void>;
  resolveServerOrderId: (order: Order) => Promise<string | null>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  returnOrder: (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]) => Promise<ReturnResult>;
  collectDebt: (customerId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  syncDebtsFromServer: () => Promise<{ updated: number; skipped: number }>;
  paySupplierDebt: (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  addProject: (project: Omit<Project, 'id' | 'code'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  exportProjectMaterial: (projectId: string, productId: string, quantity: number) => Promise<Project | null>;
  exportProjectMaterialBatch: (
    projectId: string,
    lines: { productId: string; quantity: number }[]
  ) => Promise<Project | null>;
  // ---- 0064: điều chỉnh tồn / hao hụt ----
  stockAdjustments: StockAdjustment[];
  refreshServerStockAdjustments: (force?: boolean) => Promise<boolean>;
  adjustStock: (
    lines: { productId: string; countedStock?: number; delta?: number }[],
    reason: StockAdjustReason,
    options?: { note?: string; projectId?: string | null }
  ) => Promise<{ code: string; adjusted: number; lossAmount: number } | null>;
  assignAdjustProject: (adjustmentId: string, projectId: string) => Promise<boolean>;
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
  // ---- 0066: xoá dự án tạo nhầm ----
  deleteProject: (projectId: string) => Promise<{
    code: string;
    material_lines: number;
    worker_lines: number;
    restored_lines: number;
    unlinked_adjustments: number;
  } | null>;
  refreshServerProjects: () => Promise<boolean>;
  syncProjects: () => Promise<void>;
  syncPendingOps: (retryFailed?: boolean) => Promise<{ synced: number; failed: number }>;
  closeShift: (countedCash: number) => Promise<boolean>;
  openNewShift: (startingCash: number) => Promise<boolean>;
  refreshShiftFromServer: () => Promise<boolean>;
  addCashbookEntry: (entry: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>) => Promise<boolean>;
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
}

const TransactionsContext = createContext<TransactionsSlice | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const cart = useTxCart();
  // Back-edges qua ref để tránh phụ thuộc vòng tròn lúc khởi tạo:
  // shift-stock cần pendingQueue (orders, tạo sau) + syncPendingOps (debts, tạo sau).
  const syncPendingOpsRef = useRef<(retryFailed?: boolean) => Promise<{ synced: number; failed: number }>>(async () => ({ synced: 0, failed: 0 }));
  const pendingQueueRef = useRef<Order[]>([]);
  const shiftStock = useTxShiftStock({ syncPendingOpsRef, pendingQueueRef });
  const debts = useTxDebts({
    currentShift: shiftStock.currentShift,
    setCashbook: shiftStock.setCashbook,
    setCurrentShift: shiftStock.setCurrentShift,
  });
  useEffect(() => {
    syncPendingOpsRef.current = debts.syncPendingOps;
  }, [debts.syncPendingOps, syncPendingOpsRef]);
  const orders = useTxOrders({
    activeCart: cart.activeCart,
    updateActiveTab: cart.updateActiveTab,
    calculatedTotals: cart.calculatedTotals,
    clearActiveCart: cart.clearActiveCart,
    setReceiptModalOrder: cart.setReceiptModalOrder,
    setShiftModalOpen: cart.setShiftModalOpen,
    currentShift: shiftStock.currentShift,
    setCurrentShift: shiftStock.setCurrentShift,
    setCashbook: shiftStock.setCashbook,
  });
  useEffect(() => {
    pendingQueueRef.current = orders.pendingQueue;
  }, [orders.pendingQueue, pendingQueueRef]);
  const projects = useTxProjects({
    currentShift: shiftStock.currentShift,
    setCashbook: shiftStock.setCashbook,
    setCurrentShift: shiftStock.setCurrentShift,
    setStockMovements: shiftStock.setStockMovements,
  });

  // Thu ngân hiện tại gắn với tài khoản đăng nhập (giữ công thức gốc).
  const cashierName = useMemo(
    () => profile?.full_name || user?.email || 'Chưa đăng nhập',
    [profile, user]
  );

  const value: TransactionsSlice = {
    orders: orders.orders,
    setOrders: orders.setOrders,
    projects: projects.projects,
    setProjects: projects.setProjects,
    cashbook: shiftStock.cashbook,
    setCashbook: shiftStock.setCashbook,
    currentShift: shiftStock.currentShift,
    setCurrentShift: shiftStock.setCurrentShift,
    stockMovements: shiftStock.stockMovements,
    setStockMovements: shiftStock.setStockMovements,
    purchaseOrders: shiftStock.purchaseOrders,
    refreshPurchaseOrders: shiftStock.refreshPurchaseOrders,
    refreshServerPurchaseOrders: shiftStock.refreshServerPurchaseOrders,
    pendingQueue: orders.pendingQueue,
    setPendingQueue: orders.setPendingQueue,
    cashierName,
    posFlow: cart.posFlow,
    setPosFlow: cart.setPosFlow,
    posProjectId: cart.posProjectId,
    setPosProjectId: cart.setPosProjectId,
    cartTabs: cart.cartTabs,
    activeTabId: cart.activeTabId,
    setActiveTabId: cart.setActiveTabId,
    createCartTab: cart.createCartTab,
    closeCartTab: cart.closeCartTab,
    updateActiveTab: cart.updateActiveTab,
    switchPriceBook: cart.switchPriceBook,
    activeCart: cart.activeCart,
    addItemToCart: cart.addItemToCart,
    updateCartItem: cart.updateCartItem,
    removeCartItem: cart.removeCartItem,
    clearActiveCart: cart.clearActiveCart,
    dimensionModalItem: cart.dimensionModalItem,
    setDimensionModalItem: cart.setDimensionModalItem,
    receiptModalOrder: cart.receiptModalOrder,
    setReceiptModalOrder: cart.setReceiptModalOrder,
    shiftModalOpen: cart.shiftModalOpen,
    setShiftModalOpen: cart.setShiftModalOpen,
    calculatedTotals: cart.calculatedTotals,
    checkoutActiveOrder: orders.checkoutActiveOrder,
    refreshServerOrders: orders.refreshServerOrders,
    refreshServerStockMovements: shiftStock.refreshServerStockMovements,
    refreshServerCashbook: shiftStock.refreshServerCashbook,
    syncPendingOrders: orders.syncPendingOrders,
    resolveServerOrderId: orders.resolveServerOrderId,
    cancelOrder: orders.cancelOrder,
    returnOrder: orders.returnOrder,
    collectDebt: debts.collectDebt,
    syncDebtsFromServer: debts.syncDebtsFromServer,
    paySupplierDebt: debts.paySupplierDebt,
    addProject: projects.addProject,
    updateProject: projects.updateProject,
    exportProjectMaterial: projects.exportProjectMaterial,
    exportProjectMaterialBatch: projects.exportProjectMaterialBatch,
    stockAdjustments: projects.stockAdjustments,
    refreshServerStockAdjustments: projects.refreshServerStockAdjustments,
    adjustStock: projects.adjustStock,
    assignAdjustProject: projects.assignAdjustProject,
    addProjectWorker: projects.addProjectWorker,
    removeProjectLine: projects.removeProjectLine,
    updateProjectFinance: projects.updateProjectFinance,
    collectProjectDeposit: projects.collectProjectDeposit,
    deleteProject: projects.deleteProject,
    refreshServerProjects: projects.refreshServerProjects,
    syncProjects: projects.syncProjects,
    syncPendingOps: debts.syncPendingOps,
    closeShift: shiftStock.closeShift,
    openNewShift: shiftStock.openNewShift,
    refreshShiftFromServer: shiftStock.refreshShiftFromServer,
    addCashbookEntry: shiftStock.addCashbookEntry,
    importStockBatch: shiftStock.importStockBatch,
  };
  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions(): TransactionsSlice {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions must be used within TransactionsProvider');
  return ctx;
}
