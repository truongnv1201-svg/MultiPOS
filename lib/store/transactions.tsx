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
import type { Product, Order, OrderItem, Project, CashbookEntry, Shift, DimensionDetail, StockMovement } from '../types';
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
  refreshServerStockMovements: () => Promise<boolean>;
  refreshServerCashbook: () => Promise<boolean>;
  pendingQueue: Order[];
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
  cashierName: string;
  posMode: 'standard' | 'fast';
  setPosMode: (mode: 'standard' | 'fast' | ((prev: 'standard' | 'fast') => 'standard' | 'fast')) => void;
  posFlow: 'sale' | 'import';
  setPosFlow: (flow: 'sale' | 'import' | ((prev: 'sale' | 'import') => 'sale' | 'import')) => void;
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
  dimensionModalItem: { item: OrderItem; isNew?: boolean } | null;
  setDimensionModalItem: (item: { item: OrderItem; isNew?: boolean } | null) => void;
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
    cash_rounding: number;
    payable: number;
    change_amount: number;
    debt_amount: number;
  };
  checkoutActiveOrder: (isDeposit?: boolean) => Promise<Order | null>;
  refreshServerOrders: () => Promise<boolean>;
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
  refreshShiftFromServer: () => Promise<boolean>;
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
}

const TransactionsContext = createContext<TransactionsSlice | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const { cashRounding } = useCommerce();
  const cart = useTxCart(cashRounding);
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
    pendingQueue: orders.pendingQueue,
    setPendingQueue: orders.setPendingQueue,
    cashierName,
    posMode: cart.posMode,
    setPosMode: cart.setPosMode,
    posFlow: cart.posFlow,
    setPosFlow: cart.setPosFlow,
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
    addProjectWorker: projects.addProjectWorker,
    removeProjectLine: projects.removeProjectLine,
    updateProjectFinance: projects.updateProjectFinance,
    collectProjectDeposit: projects.collectProjectDeposit,
    refreshServerProjects: projects.refreshServerProjects,
    syncProjects: projects.syncProjects,
    syncPendingOps: debts.syncPendingOps,
    closeShift: shiftStock.closeShift,
    openNewShift: shiftStock.openNewShift,
    refreshShiftFromServer: shiftStock.refreshShiftFromServer,
    addCashbookEntry: shiftStock.addCashbookEntry,
    importStock: shiftStock.importStock,
    importStockBatch: shiftStock.importStockBatch,
  };
  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions(): TransactionsSlice {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions must be used within TransactionsProvider');
  return ctx;
}
