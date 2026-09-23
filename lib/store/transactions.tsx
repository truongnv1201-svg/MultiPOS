// P3-phan 2 (tiep): slice Transactions - POS/gio, checkout, don/no/so quy/ca/nhap kho/cong trinh.
// Tang dieu phoi tien/kho; consume Auth + Commerce + Catalog + Network. Facade useStore() giu nguyen.
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './auth';
import { useCommerce } from './commerce';
import { useCatalog } from './catalog';
import { useNetwork } from './network';
import type { Product, ProductType, Order, OrderItem, Project, ProjectMaterial, ProjectWorker, CashbookEntry, Shift, PaymentItem, DimensionDetail, StockMovement, PurchaseOrder } from '../types';
import type { CartTab, ReturnResult, RestockLine, ReturnSkipped } from './types';
import { DEFAULT_TAB } from './cart';
import { toRpcItems } from './rpc';
import { db, generateOrderCode, recomputeOrderItem } from '../db';
import type { PendingOp } from '../db';
import { calcCartTotals, resolvePaidAmount } from '../pricing';
import { vietnamizeError } from '../error-vi';
import { notify } from '@/components/common/Toast';

// P0: nháº­n diá»‡n uuid server (dÃ¹ng chung cho project/NCC/váº­t tÆ° khi Ä‘á»“ng bá»™).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuidOrNull = (v?: string | null) => (v && UUID_RE.test(v) ? v : null);

// P0: xáº¿p hÃ ng Ä‘á»£i Ä‘áº©y kho/quá»¹/NCC (dedupe server báº±ng client_ref nÃªn replay an toÃ n)
async function enqueueOp(kind: PendingOp['kind'], payload: Record<string, unknown>) {
  await db.pendingOps
    .add({
      id: `op-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      kind,
      payload,
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    })
    .catch(console.warn);
}

const EMPTY_SHIFT: Shift = {
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
};

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
  syncPendingOps: () => Promise<{ synced: number; failed: number }>;
  closeShift: (countedCash: number) => Promise<boolean>;
  openNewShift: (startingCash: number) => Promise<void>;
  refreshShiftFromServer: () => Promise<boolean>;
  addCashbookEntry: (entry: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>) => Promise<boolean>;
  importStock: (productId: string, quantity: number, importPrice: number, supplierName?: string, note?: string) => Promise<void>;
  importStockBatch: (
    lines: { productId: string; quantity: number; importPrice: number }[],
    supplierName?: string,
    note?: string
  ) => Promise<boolean>;
}

const TransactionsContext = createContext<TransactionsSlice | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { shop, cashRounding } = useCommerce();
  const { products, setProducts, suppliers, setSuppliers, customers, setCustomers, customerMap, syncCustomers, refreshCatalog } = useCatalog();
  const { isOnline } = useNetwork();
  const [orders, setOrders] = useState<Order[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cashbook, setCashbook] = useState<CashbookEntry[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift>(EMPTY_SHIFT);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  const refreshServerOrders = useCallback(async (): Promise<boolean> => {
    if (!supa || !user || !isOnline) return false;
    try {
      const { data: serverOrders, error: ordersError } = await supa
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (ordersError) throw ordersError;

      const orderIds = (serverOrders || []).map((row: { id: string }) => row.id);
      const { data: serverItems, error: itemsError } =
        orderIds.length > 0
          ? await supa.from('order_items').select('*').in('order_id', orderIds)
          : { data: [], error: null };
      if (itemsError) throw itemsError;

      const itemsByOrder = new Map<string, OrderItem[]>();
      for (const row of (serverItems || []) as any[]) {
        const item: OrderItem = {
          id: row.id,
          product_id: row.product_id || '',
          sku: row.sku,
          name: row.name,
          product_type: row.item_type as ProductType,
          unit: row.unit,
          unit_price: Number(row.unit_price || 0),
          quantity: Number(row.quantity || 0),
          discount_amount: Number(row.discount_amount || 0),
          processing_fee: Number(row.processing_fee || 0),
          subtotal: Number(row.subtotal || 0),
          dimension_details: row.dimension_details || undefined,
          waste_factor: row.waste_factor != null ? Number(row.waste_factor) : undefined,
          material_consumed: row.material_consumed != null ? Number(row.material_consumed) : undefined,
        };
        const list = itemsByOrder.get(row.order_id) || [];
        list.push(item);
        itemsByOrder.set(row.order_id, list);
      }

      const mapped: Order[] = (serverOrders || []).map((row: any) => ({
        id: `server-${row.id}`,
        server_id: row.id,
        order_code: row.order_code,
        customer_id: row.customer_id || undefined,
        customer_name: row.customer_name || 'KhÃ¡ch Láº»',
        items: itemsByOrder.get(row.id) || [],
        subtotal: Number(row.subtotal || 0),
        discount_amount: Number(row.discount_amount || 0),
        discount_percent: 0,
        shipping_fee: Number(row.shipping_fee || 0),
        vat_amount: Number(row.vat_amount || 0),
        vat_percent: 0,
        cash_rounding: Number(row.cash_rounding || 0),
        total_amount: Number(row.total_amount || 0),
        paid_amount: Number(row.paid_amount || 0),
        debt_amount: Number(row.debt_amount || 0),
        change_amount: Number(row.change_amount || 0),
        payments: row.paid_amount > 0 ? [{ method: 'cash', amount: Number(row.paid_amount) }] : [],
        status: row.status,
        note: row.note || undefined,
        created_at: row.created_at,
        cashier_name: row.cashier_id === user.id ? (profile?.full_name || user.email || '') : 'NhÃ¢n viÃªn',
        is_offline: false,
      }));

      setOrders((previous) => {
        const pendingLocal = previous.filter((order) => order.is_offline && !order.server_id);
        return [...pendingLocal, ...mapped];
      });
      await db.orders.bulkPut(mapped);
      return true;
    } catch (error) {
      console.warn('Server orders refresh failed:', error);
      return false;
    }
  }, [supa, user, isOnline, profile]);

  const refreshServerStockMovements = useCallback(async (): Promise<boolean> => {
    if (!supa || !user || !isOnline) return false;
    try {
      const { data, error } = await supa
        .from('stock_movements')
        .select('id, reference_code, product_id, quantity, previous_stock, new_stock, note, created_at, products(name)')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      const mapped: StockMovement[] = ((data || []) as any[]).map((row) => {
        const note = row.note || '';
        const movementType: StockMovement['movement_type'] = /nháº­p|nhap|tráº£|tra|restock/i.test(note)
          ? 'return'
          : /cÃ´ng trÃ¬nh|project/i.test(note)
            ? 'export_project'
            : /bÃ¡n|checkout|sales/i.test(note)
              ? 'export_sales'
              : 'import';
        const product = Array.isArray(row.products) ? row.products[0] : row.products;
        return {
          id: row.id,
          reference_code: row.reference_code,
          product_id: row.product_id || '',
          product_name: product?.name || 'Sáº£n pháº©m Ä‘Ã£ xÃ³a',
          movement_type: movementType,
          quantity: Number(row.quantity || 0),
          previous_stock: row.previous_stock == null ? 0 : Number(row.previous_stock),
          new_stock: row.new_stock == null ? 0 : Number(row.new_stock),
          note,
          created_at: row.created_at,
        };
      });
      setStockMovements(mapped);
      return true;
    } catch (error) {
      console.warn('Stock movement sync failed:', error);
      return false;
    }
  }, [supa, user, isOnline]);

  // P1 sá»• quá»¹ Ä‘a mÃ¡y: kÃ©o bÃºt toÃ¡n server vá» há»™i tá»¥ (ghi váº«n chá»‰ qua RPC).
  // Server tháº¯ng; giá»¯ báº£n local chÆ°a synced (nháº­p kho, voucher chá» Ä‘áº©y, offline).
  // Dedupe legacy 1 láº§n: báº£n local cÅ© trÃ¹ng (loáº¡i, háº¡ng má»¥c, tiá»n, tham chiáº¿u,
  // Ä‘á»‘i tÃ¡c, cÃ¹ng ngÃ y) vá»›i dÃ²ng server -> Ä‘Ã¡nh dáº¥u synced, khá»i hiá»‡n 2 láº§n.
  const refreshServerCashbook = useCallback(async (): Promise<boolean> => {
    if (!supa || !user || !isOnline) return false;
    try {
      const { data, error } = await supa
        .from('cashbook_entries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error || !data) return false;
      const validCats: CashbookEntry['category'][] = [
        'sales', 'deposit', 'debt_collection', 'supplier_payment',
        'labor', 'material', 'advance', 'other',
      ];
      const mapped: CashbookEntry[] = (data as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        code: typeof row.code === 'string' ? row.code : '',
        type: row.type === 'expense' ? 'expense' : 'receipt',
        fund_type: row.fund_type === 'bank' ? 'bank' : 'cash',
        category: validCats.includes(row.category as CashbookEntry['category'])
          ? (row.category as CashbookEntry['category'])
          : 'other',
        amount: Number(row.amount) || 0,
        reference_order_code:
          typeof row.reference_order_code === 'string' ? row.reference_order_code : undefined,
        partner_name: typeof row.partner_name === 'string' ? row.partner_name : undefined,
        note: typeof row.note === 'string' ? row.note : '',
        created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        synced: true,
      }));
      const keyOf = (e: {
        type: string;
        category: string;
        amount: number;
        reference_order_code?: string;
        partner_name?: string;
        created_at: string;
      }) =>
        [
          e.type,
          e.category,
          Math.round(e.amount),
          e.reference_order_code || '',
          e.partner_name || '',
          (e.created_at || '').slice(0, 10),
        ].join('|');
      const serverKeys = new Set(mapped.map(keyOf));
      const localRows = await db.cashbook.toArray().catch(() => [] as CashbookEntry[]);
      const promotedIds: string[] = [];
      const keptLocal: CashbookEntry[] = [];
      for (const e of localRows) {
        if (e.synced) continue;
        if (serverKeys.has(keyOf(e))) {
          promotedIds.push(e.id);
          continue;
        }
        keptLocal.push(e);
      }
      if (promotedIds.length > 0) {
        await db.cashbook.where('id').anyOf(promotedIds).modify({ synced: true }).catch(() => {});
      }
      const next = [...mapped, ...keptLocal].sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1
      );
      setCashbook(next);
      await db.cashbook.clear().catch(() => {});
      await db.cashbook.bulkAdd(next).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Cashbook pull failed (giá»¯ local):', err);
      return false;
    }
  }, [supa, user, isOnline]);

  // cashierName gáº¯n vá»›i tÃ i khoáº£n Ä‘Äƒng nháº­p (fix: trÆ°á»›c Ä‘Ã¢y hard-code 'Nguyá»…n VÄƒn A'
  // nÃªn chÆ°a login váº«n má»Ÿ/káº¿t ca Ä‘Æ°á»£c). ChÆ°a login -> 'ChÆ°a Ä‘Äƒng nháº­p'.

  const [pendingQueue, setPendingQueue] = useState<Order[]>([]);

  // Thu ngÃ¢n hiá»‡n táº¡i gáº¯n vá»›i tÃ i khoáº£n Ä‘Äƒng nháº­p (fix káº¿t ca áº©n danh)
  const cashierName = useMemo(
    () => profile?.full_name || user?.email || 'ChÆ°a Ä‘Äƒng nháº­p',
    [profile, user]
  );

  // POS State
  const [posMode, setPosMode] = useState<'standard' | 'fast'>('fast'); // Máº·c Ä‘á»‹nh bÃ¡n nhanh
  const [posFlow, setPosFlow] = useState<'sale' | 'import'>('sale'); // Luá»“ng POS hiá»‡n táº¡i
  const [cartTabs, setCartTabs] = useState<CartTab[]>([DEFAULT_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  // Modals
  const [dimensionModalItem, setDimensionModalItem] = useState<{ item: OrderItem; isNew?: boolean } | null>(null);
  const [receiptModalOrder, setReceiptModalOrder] = useState<Order | null>(null);
  const [shiftModalOpen, setShiftModalOpen] = useState<boolean>(false);

  const activeCart = useMemo(() => {
    return cartTabs.find((t) => t.id === activeTabId) || cartTabs[0] || DEFAULT_TAB;
  }, [cartTabs, activeTabId]);

  // Tab operations â€” tab má»›i Äƒn theo máº·c Ä‘á»‹nh POS trong CÃ i Ä‘áº·t
  const createCartTab = useCallback(() => {
    if (cartTabs.length >= 5) {
      alert('Chá»‰ Ä‘Æ°á»£c má»Ÿ tá»‘i Ä‘a 5 hÃ³a Ä‘Æ¡n cÃ¹ng lÃºc! HÃ£y thanh toÃ¡n hoáº·c Ä‘Ã³ng bá»›t tab.');
      return;
    }
    const newId = `tab-${Date.now()}`;
    const newName = `HD ${cartTabs.length + 1}`;
    const newTab: CartTab = {
      ...DEFAULT_TAB,
      id: newId,
      name: newName,
      items: [],
      vat_percent: shop.defaultVat ?? 0,
      payment_method: shop.defaultPayment ?? 'cash',
      price_book: shop.defaultPriceBook ?? 'retail',
    };
    setCartTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, [cartTabs.length, shop.defaultVat, shop.defaultPayment, shop.defaultPriceBook]);

  const closeCartTab = useCallback((tabId: string) => {
    setCartTabs((prev) => {
      if (prev.length <= 1) return prev; // Keep at least one tab
      const nextTabs = prev.filter((t) => t.id !== tabId);
      return nextTabs;
    });
    setActiveTabId((current) => {
      if (current === tabId) {
        const remaining = cartTabs.filter((t) => t.id !== tabId);
        return remaining[0]?.id || 'tab-1';
      }
      return current;
    });
  }, [cartTabs]);

  const updateActiveTab = useCallback((updater: Partial<CartTab> | ((prev: CartTab) => CartTab)) => {
    setCartTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        if (typeof updater === 'function') {
          return updater(tab);
        }
        return { ...tab, ...updater };
      })
    );
  }, [activeTabId]);

  // Cart Item Operations
  const addItemToCart = useCallback(
    (product: Product, quantity = 1, dimensionDetails?: DimensionDetail[], priceOverride?: number) => {
      updateActiveTab((tab) => {
        const itemPrice =
          priceOverride !== undefined
            ? priceOverride
            : tab.price_book === 'trade' && product.trade_price
            ? product.trade_price
            : product.retail_price;

        const existingIndex = tab.items.findIndex(
          (item) => item.product_id === product.id && item.product_type !== 'area'
        );

        if (existingIndex >= 0 && product.product_type !== 'area') {
          // Increase quantity for standard items
          const updatedItems = [...tab.items];
          const current = updatedItems[existingIndex];
          const newQty = current.quantity + quantity;
          updatedItems[existingIndex] = recomputeOrderItem({
            ...current,
            quantity: newQty,
          });
          return { ...tab, items: updatedItems };
        }

        // New item
        const newItem: OrderItem = {
          id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          product_type: product.product_type,
          unit: product.unit,
          unit_price: itemPrice,
          quantity: quantity,
          discount_amount: 0,
          processing_fee: 0,
          subtotal: itemPrice * quantity,
          waste_factor: product.waste_factor,
          dimension_details: dimensionDetails,
        };

        const computed = recomputeOrderItem(newItem);
        return { ...tab, items: [...tab.items, computed] };
      });
    },
    [updateActiveTab]
  );

  const switchPriceBook = useCallback(
    (priceBook: 'retail' | 'trade') => {
      updateActiveTab((tab) => {
        const updatedItems = tab.items.map((item) => {
          const product = products.find((p) => p.id === item.product_id);
          if (!product) return item;
          const targetPrice =
            priceBook === 'trade' && product.trade_price ? product.trade_price : product.retail_price;
          return recomputeOrderItem({
            ...item,
            unit_price: targetPrice,
          });
        });
        return {
          ...tab,
          price_book: priceBook,
          items: updatedItems,
        };
      });
    },
    [products, updateActiveTab]
  );

  const updateCartItem = useCallback(
    (itemId: string, updates: Partial<OrderItem>) => {
      updateActiveTab((tab) => {
        const updatedItems = tab.items.map((item) => {
          if (item.id !== itemId) return item;
          return recomputeOrderItem({ ...item, ...updates });
        });
        return { ...tab, items: updatedItems };
      });
    },
    [updateActiveTab]
  );

  const removeCartItem = useCallback(
    (itemId: string) => {
      updateActiveTab((tab) => ({
        ...tab,
        items: tab.items.filter((i) => i.id !== itemId),
      }));
    },
    [updateActiveTab]
  );

  const clearActiveCart = useCallback(() => {
    updateActiveTab({
      items: [],
      discount_amount: 0,
      discount_percent: 0,
      shipping_fee: 0,
      shipping_type: 'vnd',
      shipping_percent: 0,
      tendered_amount: 0,
      note: '',
      is_deposit_mode: false,
    });
  }, [updateActiveTab]);

  // Calculations for current active order
  // Tá»•ng giá» dÃ¹ng chung lib/pricing (single source, cÃ³ unit test) â€” khá»›p server tá»«ng Ä‘á»“ng.
  const calculatedTotals = useMemo(() => calcCartTotals(activeCart, cashRounding), [activeCart, cashRounding]);

  // Checkout Transaction Logic (SRS Â§2.2 & Invariants 1-5)
  // P3: online + Supabase -> commit nguyÃªn tá»­ qua RPC pos_checkout (server tÃ­nh láº¡i
  // tiá»n/kho/ná»£/sá»• quá»¹). Offline hoáº·c chÆ°a cáº¥u hÃ¬nh -> logic local + hÃ ng Ä‘á»£i pending.
  const checkoutActiveOrder = useCallback(
    async (isDeposit = false): Promise<Order | null> => {
      if (activeCart.items.length === 0) return null;
      // Fix thu ngÃ¢n: báº¯t buá»™c Ä‘Äƒng nháº­p (khi cÃ³ Supabase) + ca Ä‘ang má»Ÿ má»›i Ä‘Æ°á»£c bÃ¡n.
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p thu ngÃ¢n trÆ°á»›c khi thanh toÃ¡n!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca lÃ m viá»‡c chÆ°a má»Ÿ hoáº·c Ä‘Ã£ Ä‘Ã³ng! Vui lÃ²ng má»Ÿ ca má»›i (F12) trÆ°á»›c khi bÃ¡n hÃ ng.');
        setShiftModalOpen(true);
        return null;
      }
      // Ca Ä‘ang má»Ÿ pháº£i Ä‘á»©ng tÃªn ngÆ°á»i bÃ¡n (trá»« Admin/Quáº£n lÃ½) â€” khá»i dá»“n doanh sá»‘ vÃ o ca ngÆ°á»i khÃ¡c
      if (
        supa &&
        user &&
        currentShift.cashier_name !== cashierName &&
        profile?.role !== 'admin' &&
        profile?.role !== 'manager'
      ) {
        alert(
          `Ca Ä‘ang má»Ÿ Ä‘á»©ng tÃªn "${currentShift.cashier_name}", khÃ´ng pháº£i báº¡n (${cashierName}). HÃ£y káº¿t ca cÅ© (F12) / nhá» Admin rá»“i má»Ÿ ca má»›i trÆ°á»›c khi bÃ¡n.`
        );
        setShiftModalOpen(true);
        return null;
      }

      const totals = calculatedTotals;
      let orderCode = generateOrderCode('HD');
      // P0-idempotency: khÃ³a á»•n Ä‘á»‹nh cho 1 láº§n bÃ¡n â€” gá»­i lÃªn server Ä‘á»ƒ retry/timeout
      // máº­p má» khÃ´ng sinh trÃ¹ng Ä‘Æ¡n; Ä‘Æ¡n offline dÃ¹ng luÃ´n id nÃ y khi replay.
      const clientRef = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      // Ã” trá»‘ng = tráº£ Ä‘á»§ CHá»ˆ cho chuyá»ƒn khoáº£n/quáº¹t tháº»; tiá»n máº·t báº¯t buá»™c Ä‘Ã£ nháº­p (UI cháº·n),
      // ná»£ ghi 0 Ä‘á»ƒ rÆ¡i vÃ o guard ná»£ vÃ´ chá»§ (chung lib/pricing vá»›i POSScreen)
      let paidAmount = resolvePaidAmount(totals.payable, activeCart.payment_method, activeCart.tendered_amount || 0);
      let actualDebt = totals.payable - paidAmount;
      // Sá»‘ liá»‡u hiá»‡u dá»¥ng: máº·c Ä‘á»‹nh = tÃ­nh local, server ghi Ä‘Ã¨ khi commit RPC thÃ nh cÃ´ng
      let effSubtotal = totals.subtotal;
      let effDiscount = totals.discount_amount;
      let effVat = totals.vat_amount;
      let effRounding = totals.cash_rounding;
      let effPayable = totals.payable;
      let effChange = totals.change_amount;
      let serverOrderId: string | null = null;
      // P1 sá»• quá»¹ Ä‘a mÃ¡y: RPC thÃ nh cÃ´ng lÃ  server Ä‘Ã£ ghi receipt -> mirror local
      // Ä‘Ã¡nh dáº¥u synced Ä‘á»ƒ láº§n pull sau khÃ´ng trÃ¹ng dÃ²ng.
      let serverCommitted = false;

      if (isOnline && supa) {
        try {
          // 0009: ná»£ > 0 mÃ  KH chÆ°a map uuid server -> sync gáº¥p trÆ°á»›c khi commit
          // (server guard sáº½ rollback náº¿u ná»£ vÃ´ chá»§)
          let serverCustId: string | null =
            activeCart.customer_id ? customerMap[activeCart.customer_id] ?? null : null;
          if (actualDebt > 0 && activeCart.customer_id && !serverCustId) {
            const fresh = await syncCustomers();
            serverCustId = fresh[activeCart.customer_id] ?? null;
          }
          // Gá»­i TIá»€N KHÃCH ÄÆ¯A (khÃ´ng káº¹p á»Ÿ payable) Ä‘á»ƒ server chia paid/change/debt lÃ m
          // chuáº©n â€” trÆ°á»›c Ä‘Ã¢y káº¹p paid á»Ÿ payable nÃªn hÃ³a Ä‘Æ¡n online khÃ´ng bao giá» hiá»‡n tiá»n
          // thá»«a (bug lá»™ bá»Ÿi fuzz parity). Ã” trá»‘ng = tráº£ Ä‘á»§ cho chuyá»ƒn khoáº£n/quáº¹t tháº»
          // (khá»›p resolvePaidAmount); cash trá»‘ng Ä‘Ã£ bá»‹ UI cháº·n tá»« POSScreen.
          let tendered = activeCart.tendered_amount || 0;
          if (activeCart.payment_method !== 'cash' && activeCart.payment_method !== 'debt' && tendered <= 0) {
            tendered = totals.payable;
          }
          const rpcPayments =
            activeCart.payment_method === 'debt' || tendered <= 0
              ? []
              : [{ method: activeCart.payment_method, amount: tendered }];
          // 0023: server tÃ­nh VAT riÃªng qua p_vat_percent (khá»›p calculatedTotals tá»«ng Ä‘á»“ng).
          // Server chÆ°a migrate (khÃ´ng cÃ³ overload 9-arg) -> PostgREST PGRST202 -> fallback
          // cÃ¡ch cÅ©: gá»™p VAT vÃ o ship Ä‘á»ƒ total váº«n khá»›p.
          const rpcBase = {
            p_customer_name: activeCart.customer_name || 'KhÃ¡ch Láº» Mua Táº¡i Quáº§y',
            p_items: toRpcItems(activeCart.items),
            p_discount: totals.discount_amount,
            p_payments: rpcPayments,
            p_note: activeCart.note || null,
            p_shipping_fee: totals.shipping_fee || 0,
            p_is_deposit: isDeposit,
            p_customer_id: serverCustId,
          };
          let data: any = null;
          let rpcError: any = null;
          const first = await supa.rpc('pos_checkout', {
            ...rpcBase,
            p_vat_percent: activeCart.vat_percent || 0,
            p_client_ref: clientRef,
          });
          if (first.error && /PGRST202|could not find.*function|schema cache/i.test(first.error.message || '')) {
            const retry = await supa.rpc('pos_checkout', {
              ...rpcBase,
              p_shipping_fee: (totals.shipping_fee || 0) + (totals.vat_amount || 0),
            });
            data = retry.data;
            rpcError = retry.error;
          } else {
            data = first.data;
            rpcError = first.error;
          }
          if (rpcError) throw new Error(rpcError.message);
          serverCommitted = true;
          const res = data as {
            order_id?: string;
            order_code: string;
            change_amount: number;
            subtotal: number;
            discount_amount: number;
            vat_amount?: number;
            cash_rounding: number;
            total_amount: number;
            paid_amount: number;
            debt_amount: number;
          };
          orderCode = res.order_code;
          // 0024: giá»¯ UUID server Ä‘á»ƒ cancel/return gá»i Ä‘Ãºng Ä‘Æ¡n (khá»i lookup)
          serverOrderId = typeof res.order_id === 'string' ? res.order_id : null;
          effSubtotal = Number(res.subtotal);
          effDiscount = Number(res.discount_amount);
          effVat = res.vat_amount != null ? Number(res.vat_amount) : totals.vat_amount;
          effRounding = Number(res.cash_rounding);
          effPayable = Number(res.total_amount);
          paidAmount = Number(res.paid_amount);
          actualDebt = Number(res.debt_amount);
          effChange = Number(res.change_amount);
        } catch (err: any) {
          alert(`Lá»—i commit server â€” giá»¯ nguyÃªn giá» Ä‘á»ƒ thá»­ láº¡i: ${vietnamizeError(err)}`);
          return null;
        }
      }

      const orderPayments: PaymentItem[] =
        paidAmount > 0
          ? [
              {
                method: activeCart.payment_method,
                amount: paidAmount,
                reference: activeCart.payment_method === 'transfer' ? `VietQR-${orderCode}` : undefined,
              },
            ]
          : [];

      const newOrder: Order = {
        id: clientRef,
        server_id: serverOrderId ?? undefined,
        order_code: orderCode,
        customer_id: activeCart.customer_id,
        customer_name: activeCart.customer_name || 'KhÃ¡ch Láº» Mua Táº¡i Quáº§y',
        customer_phone: activeCart.customer_phone,
        items: [...activeCart.items],
        subtotal: effSubtotal,
        discount_amount: effDiscount,
        discount_percent: activeCart.discount_percent,
        shipping_fee: totals.shipping_fee,
        tendered_amount: activeCart.tendered_amount || 0,
        vat_amount: effVat,
        vat_percent: activeCart.vat_percent || 0,
        cash_rounding: effRounding,
        total_amount: effPayable,
        paid_amount: paidAmount,
        debt_amount: actualDebt,
        change_amount: effChange,
        payments: orderPayments,
        status: isDeposit ? 'deposit_order' : 'completed',
        note: activeCart.note,
        created_at: new Date().toISOString(),
        cashier_name: cashierName,
        is_offline: !isOnline,
      };

      // 1. Inventory Invariant: GROUP BY variant & deduct stock
      // Skip service & combo parents (INV-ERR-02)
      // Combo parents deduct child items
      const stockDeductions: Record<string, number> = {};

      for (const item of activeCart.items) {
        if (item.product_type === 'service') continue;

        if (item.product_type === 'combo') {
          const comboProduct = products.find((p) => p.id === item.product_id);
          if (comboProduct?.combo_items) {
            for (const child of comboProduct.combo_items) {
              const needed = child.quantity * item.quantity;
              stockDeductions[child.product_id] = (stockDeductions[child.product_id] || 0) + needed;
            }
          }
          continue;
        }

        // Regular item hoáº·c area: area tÃ­nh theo m2 thá»±c x waste hiá»‡n táº¡i (mirror server 0028),
        // khÃ´ng tin material_consumed cÅ© trong giá»
        if (item.product_type === 'area' && item.dimension_details && item.dimension_details.length > 0) {
          const prod = products.find((p) => p.id === item.product_id);
          const waste = prod?.waste_factor ?? item.waste_factor ?? 0;
          const m2 = item.dimension_details.reduce((s, d) => s + (d.actual_m2 || 0), 0);
          const need = Math.round(m2 * (1 + waste / 100) * 1000) / 1000;
          stockDeductions[item.product_id] = (stockDeductions[item.product_id] || 0) + need;
        } else {
          const qtyToDeduct = item.quantity;
          stockDeductions[item.product_id] = (stockDeductions[item.product_id] || 0) + qtyToDeduct;
        }
      }

      // P0-3: cháº·n bÃ¡n lá»‘ kho ngay cáº£ offline (server sáº½ RAISE + rollback,
      // Ä‘Æ¡n offline replay fail sáº½ káº¹t queue cÃ¢m). Kiá»ƒm tra trÆ°á»›c khi trá»«.
      const insufficient: string[] = [];
      for (const [pid, need] of Object.entries(stockDeductions)) {
        const p = products.find((x) => x.id === pid);
        if (p && p.stock_quantity < need) insufficient.push(`${p.sku} (tá»“n ${p.stock_quantity}, cáº§n ${need})`);
        // Combo con thiáº¿u cÅ©ng Ä‘Ã£ gá»™p trong stockDeductions qua child.product_id nÃªn check chung.
      }
      // Kiá»ƒm tra linh kiá»‡n combo con thiáº¿u theo tÃªn Ä‘á»ƒ bÃ¡o rÃµ
      if (insufficient.length > 0) {
        alert(`Tá»“n kho khÃ´ng Ä‘á»§, khÃ´ng thá»ƒ bÃ¡n:\n${insufficient.join('\n')}\nHÃ£y giáº£m SL hoáº·c nháº­p kho thÃªm.`);
        return null;
      }

      // Update in-memory and DB stock (khÃ´ng káº¹p max(0) Ä‘á»ƒ khá»i lá»‡ch truth vá»›i server)
      setProducts((prev) =>
        prev.map((p) => {
          const deduct = stockDeductions[p.id];
          if (deduct) {
            const nextStock = Math.round((p.stock_quantity - deduct) * 1000) / 1000;
            db.products.update(p.id, { stock_quantity: nextStock }).catch(console.warn);
            return { ...p, stock_quantity: nextStock };
          }
          return p;
        })
      );

      // 2. Customer Debt update (current_debt >= 0)
      if (actualDebt > 0 && activeCart.customer_id) {
        setCustomers((prev) =>
          prev.map((c) => {
            if (c.id === activeCart.customer_id) {
              const nextDebt = c.current_debt + actualDebt;
              db.customers.update(c.id, { current_debt: nextDebt }).catch(console.warn);
              return { ...c, current_debt: nextDebt };
            }
            return c;
          })
        );
      }

      // 3. Cashbook Invariant: Single real recording
      // Category: isDeposit ? 'deposit' : 'sales' (FIN-ERR-01)
      if (paidAmount > 0) {
        const cashbookCode = generateOrderCode('PT');
        const newEntry: CashbookEntry = {
          id: `cb-${Date.now()}`,
          code: cashbookCode,
          type: 'receipt',
          fund_type: activeCart.payment_method === 'cash' ? 'cash' : 'bank',
          category: isDeposit ? 'deposit' : 'sales',
          amount: paidAmount,
          reference_order_code: orderCode,
          partner_name: activeCart.customer_name,
          note: isDeposit
            ? `Thu cá»c Ä‘Æ¡n hÃ ng ${orderCode}`
            : `Thanh toÃ¡n hÃ³a Ä‘Æ¡n ${orderCode} (${activeCart.payment_method === 'cash' ? 'Tiá»n máº·t' : 'Chuyá»ƒn khoáº£n VietQR'})`,
          created_at: new Date().toISOString(),
          synced: serverCommitted || undefined,
        };

        setCashbook((prev) => [newEntry, ...prev]);
        db.cashbook.add(newEntry).catch(console.warn);

        // Update current shift stats
        setCurrentShift((prev) => {
          const isCash = activeCart.payment_method === 'cash';
          const updatedShift: Shift = {
            ...prev,
            cash_sales: isCash && !isDeposit ? prev.cash_sales + paidAmount : prev.cash_sales,
            transfer_sales: !isCash ? prev.transfer_sales + paidAmount : prev.transfer_sales,
            deposit_collected: isDeposit && isCash ? prev.deposit_collected + paidAmount : prev.deposit_collected,
            expected_cash: isCash ? prev.expected_cash + paidAmount : prev.expected_cash,
            order_count: prev.order_count + 1,
          };
          db.shifts.put(updatedShift).catch(console.warn);
          return updatedShift;
        });
      }

      // 4. Save order to DB and state
      setOrders((prev) => [newOrder, ...prev]);
      await db.orders.add(newOrder);

      // 5. Offline Queue Handling (OFF-ERR-01)
      if (!isOnline) {
        setPendingQueue((prev) => [...prev, newOrder]);
        await db.pendingOrders.add(newOrder);
      }

      // 6. Reset current cart
      clearActiveCart();

      // ThÃ´ng bÃ¡o thÃ nh cÃ´ng (ká»ƒ cáº£ khi táº¯t In tá»± Ä‘á»™ng nÃªn khÃ´ng má»Ÿ phiáº¿u)
      const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} Ä‘`;
      notify(
        isDeposit
          ? `Thu cá»c thÃ nh cÃ´ng ${orderCode}\nÄÃ£ nháº­n: ${vnd(paidAmount)}`
          : actualDebt > 0
            ? `Thanh toÃ¡n thÃ nh cÃ´ng ${orderCode}\nÄÃ£ thu: ${vnd(paidAmount)} â€¢ CÃ²n ná»£: ${vnd(actualDebt)}`
            : effChange > 0
              ? `Thanh toÃ¡n thÃ nh cÃ´ng ${orderCode}\nÄÃ£ thu: ${vnd(paidAmount)} â€¢ Thá»‘i láº¡i: ${vnd(effChange)}`
              : `Thanh toÃ¡n thÃ nh cÃ´ng ${orderCode}\nÄÃ£ thu: ${vnd(paidAmount)}`,
        'success',
      );

      // In tá»± Ä‘á»™ng (CÃ i Ä‘áº·t â†’ Trung tÃ¢m in áº¥n): Báº¬T = tá»± má»Ÿ phiáº¿u sau bÃ¡n Ä‘á»ƒ báº¥m In;
      // Táº®T = vá» bÃ¡n tiáº¿p luÃ´n, xem/in láº¡i trong ÄÆ¡n hÃ ng. Máº·c Ä‘á»‹nh Báº¬T (!== false
      // Ä‘á»ƒ mÃ¡y cÅ© chÆ°a cÃ³ key nÃ y váº«n giá»¯ hÃ nh vi cÅ©).
      if (shop.autoPrint !== false) {
        setReceiptModalOrder(newOrder);
      }

      return newOrder;
    },
    [
      activeCart,
      calculatedTotals,
      cashierName,
      isOnline,
      supa,
      user,
      profile,
      currentShift,
      customerMap,
      syncCustomers,
      products,
      clearActiveCart,
      setLoginOpen,
      setCustomers,
      setProducts,
      shop.autoPrint,
    ]
  );

  // Sync Offline Queue
  // P3: cÃ³ Supabase -> replay tá»«ng Ä‘Æ¡n offline lÃªn server qua pos_checkout rá»“i má»›i
  // xÃ³a hÃ ng Ä‘á»£i (Ä‘Æ¡n replay nháº­n mÃ£ HD má»›i cá»§a server; mÃ£ offline cÅ© giá»¯ á»Ÿ mÃ¡y tráº¡m).
  // ChÆ°a cáº¥u hÃ¬nh server -> hÃ nh vi cÅ© (Ä‘Ã¡nh dáº¥u Ä‘Ã£ sync).
  const syncPendingOrders = useCallback(async () => {
    if (!isOnline || pendingQueue.length === 0) return;
    if (supa) {
      const syncedIds: string[] = [];
      const remaining: Order[] = [];
      const failures: string[] = [];
      for (const o of pendingQueue) {
        try {
          // ÄÆ¡n offline má»›i (cÃ³ vat_percent) -> gá»­i VAT riÃªng cho server 0023.
          // ÄÆ¡n offline cÅ© (khÃ´ng cÃ³ vat_*, VAT náº±m láº«n trong total) -> khÃ´i phá»¥c residual
          // = total - (subtotal - discount + ship - rounding) rá»“i gá»™p vÃ o ship (tÆ°Æ¡ng thÃ­ch
          // cáº£ server cÅ© láº«n má»›i).
          const oVatPct = o.vat_percent || 0;
          const vatResidual = Math.max(
            0,
            (o.total_amount || 0) -
              ((o.subtotal || 0) - (o.discount_amount || 0) + (o.shipping_fee || 0) - (o.cash_rounding || 0))
          );
          // Replay gá»­i TIá»€N KHÃCH ÄÆ¯A (nhÆ° checkout online) Ä‘á»ƒ server chia paid/change/debt.
          // ÄÆ¡n má»›i cÃ³ tendered_amount; Ä‘Æ¡n cÅ© fallback paid Ä‘Ã£ káº¹p trong payments.
          const payMethod = o.payments.length > 0 ? o.payments[0].method : 'debt';
          let replayTendered = o.tendered_amount || 0;
          if (replayTendered <= 0 && payMethod !== 'cash' && payMethod !== 'debt') {
            replayTendered = o.payments[0]?.amount || 0;
          }
          const replayBase = {
            p_customer_name: o.customer_name,
            p_items: toRpcItems(o.items),
            p_discount: o.discount_amount,
            p_payments:
              payMethod === 'debt' || replayTendered <= 0
                ? []
                : [{ method: payMethod, amount: replayTendered }],
            p_note: o.note || null,
            p_shipping_fee: (o.shipping_fee || 0) + (oVatPct > 0 ? 0 : vatResidual),
            p_is_deposit: o.status === 'deposit_order',
            p_customer_id: o.customer_id ? customerMap[o.customer_id] ?? null : null,
            // P0-idempotency: key á»•n Ä‘á»‹nh = id Ä‘Æ¡n local -> retry khÃ´ng sinh trÃ¹ng Ä‘Æ¡n
            p_client_ref: o.id,
          };
          let error: any = null;
          let replayData: any = null;
          if (oVatPct > 0) {
            const first = await supa.rpc('pos_checkout', {
              ...replayBase,
              p_shipping_fee: o.shipping_fee || 0,
              p_vat_percent: oVatPct,
            });
            if (first.error && /PGRST202|could not find.*function|schema cache/i.test(first.error.message || '')) {
              const legacy = await supa.rpc('pos_checkout', { ...replayBase, p_client_ref: undefined });
              error = legacy.error;
              replayData = legacy.data;
            } else {
              error = first.error;
              replayData = first.data;
            }
          } else {
            const res = await supa.rpc('pos_checkout', replayBase);
            error = res.error;
            replayData = res.data;
          }
          if (error) throw error;
          try {
            await db.pendingOrders.delete(o.id);
          } catch {
            /* best-effort */
          }
          syncedIds.push(o.id);
          // LÆ°u server_id Ä‘á»ƒ Há»§y/Tráº£ gá»i Ä‘Ãºng Ä‘Æ¡n (khá»i lookup theo mÃ£ offline cÅ©)
          const replayOrderId = (replayData as { order_id?: unknown } | null)?.order_id;
          if (typeof replayOrderId === 'string' && replayOrderId) {
            setOrders((prev) =>
              prev.map((ord) =>
                ord.id === o.id ? { ...ord, server_id: replayOrderId, is_offline: false } : ord
              )
            );
            await db.orders.update(o.id, { server_id: replayOrderId, is_offline: false }).catch(() => {});
          }
          // P1 sá»• quá»¹: replay Ä‘Ã£ ghi receipt server -> mirror local theo mÃ£ Ä‘Æ¡n offline
          // Ä‘Ã¡nh dáº¥u synced Ä‘á»ƒ pull sau khÃ´ng trÃ¹ng dÃ²ng.
          await db.cashbook
            .where('reference_order_code')
            .equals(o.order_code)
            .modify({ synced: true })
            .catch(() => {});
          setCashbook((prev) =>
            prev.map((e) =>
              e.reference_order_code === o.order_code ? { ...e, synced: true } : e
            )
          );
        } catch (e: any) {
          // P0-3: giá»¯ láº¡i + ghi lÃ½ do Ä‘á»ƒ khá»i káº¹t queue cÃ¢m (ná»£ vÃ´ chá»§ / háº¿t kho / máº¥t máº¡ng)
          remaining.push(o); // giá»¯ láº¡i Ä‘á»ƒ thá»­ Ä‘á»£t sau
          failures.push(`${o.order_code}: ${e?.message || 'lá»—i replay'}`);
        }
      }
      setPendingQueue(remaining);
      if (failures.length > 0) {
        alert(`Äá»“ng bá»™ ${failures.length} Ä‘Æ¡n offline tháº¥t báº¡i, giá»¯ láº¡i Ä‘á»ƒ thá»­ sau:\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? `\n...vÃ  ${failures.length - 5} Ä‘Æ¡n ná»¯a` : ''}`);
      }
      if (syncedIds.length > 0) {
        setOrders((prev) =>
          prev.map((ord) => (syncedIds.includes(ord.id) ? { ...ord, is_offline: false } : ord))
        );
        refreshCatalog(); // kÃ©o tá»“n kho server vá» sau replay
      }
      return;
    }
    try {
      await db.pendingOrders.clear();
      setPendingQueue([]);
      // Mark orders as synced in state
      setOrders((prev) =>
        prev.map((o) => (o.is_offline ? { ...o, is_offline: false } : o))
      );
    } catch (err) {
      console.warn('Sync pending orders error:', err);
    }
  }, [isOnline, pendingQueue, supa, customerMap, refreshCatalog]);

  // Tra UUID server cá»§a Ä‘Æ¡n (0024): Æ°u tiÃªn server_id Ä‘Ã£ lÆ°u khi checkout, fallback tra
  // theo order_code (authenticated Ä‘Æ°á»£c SELECT orders â€” RLS 0006). ÄÆ¡n chÆ°a lÃªn server -> null.
  const resolveServerOrderId = useCallback(
    async (order: Order): Promise<string | null> => {
      if (order.server_id) return order.server_id;
      if (!supa || !user || !isOnline) return null;
      try {
        const { data } = await supa.from('orders').select('id').eq('order_code', order.order_code).maybeSingle();
        const sid = (data as { id?: string } | null)?.id;
        if (sid) {
          setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, server_id: sid } : o)));
          db.orders.update(order.id, { server_id: sid }).catch(() => {});
          return sid;
        }
      } catch {
        /* tra cá»©u tháº¥t báº¡i -> coi nhÆ° chÆ°a link server */
      }
      return null;
    },
    [supa, user, isOnline]
  );

  // Cancel Order & Reverse (FIN-ERR-05)
  // 0024: Ä‘Æ¡n Ä‘Ã£ lÃªn server + online -> commit qua RPC cancel_order (server hoÃ n kho/Ä‘áº£o ná»£/
  // hoÃ n quá»¹; local mirror láº¡i cho Dexie/UI khá»›p). ÄÆ¡n server mÃ  offline -> CHáº¶N Ä‘á»ƒ khá»i lá»‡ch
  // truth. ÄÆ¡n chÆ°a lÃªn server -> xá»­ lÃ½ local + gá»¡ khá»i hÃ ng Ä‘á»£i pending.
  const cancelOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi há»§y Ä‘Æ¡n!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! KhÃ´ng Ä‘Æ°á»£c há»§y/tráº£ Ä‘Æ¡n sau khi káº¿t ca.');
        return false;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.status === 'cancelled' || order.status === 'returned') return false;

      const serverId = await resolveServerOrderId(order);
      if (serverId && !isOnline) {
        alert('ÄÆ¡n nÃ y Ä‘Ã£ Ä‘á»“ng bá»™ server nhÆ°ng Ä‘ang ngoáº¡i tuyáº¿n â€” khÃ´ng thá»ƒ há»§y lÃºc nÃ y Ä‘á»ƒ trÃ¡nh lá»‡ch kho/ná»£. HÃ£y online rá»“i thá»­ láº¡i.');
        return false;
      }
      if (serverId && supa) {
        try {
          const { error } = await supa.rpc('cancel_order', { p_order_id: serverId });
          if (error) throw new Error(error.message);
        } catch (err: any) {
          alert(`Há»§y Ä‘Æ¡n server tháº¥t báº¡i â€” giá»¯ nguyÃªn Ä‘Æ¡n Ä‘á»ƒ thá»­ láº¡i: ${vietnamizeError(err)}`);
          return false;
        }
      }

      // 1. Restore stock (mirror server 0024+0028: hÃ ng area theo m2 thá»±c x waste server,
      // hÃ ng thÆ°á»ng theo quantity, combo con theo BOM â€” khÃ´ng tin material_consumed client cÅ©)
      const restoreQty: Record<string, number> = {};
      for (const item of order.items) {
        if (item.product_type === 'service' || item.product_type === 'combo') continue;
        if (item.product_type === 'area' && item.dimension_details && item.dimension_details.length > 0) {
          const prod = products.find((p) => p.id === item.product_id);
          const waste = prod?.waste_factor ?? item.waste_factor ?? 0;
          const m2 = item.dimension_details.reduce((s, d) => s + (d.actual_m2 || 0), 0);
          const need = Math.round(m2 * (1 + waste / 100) * 1000) / 1000;
          restoreQty[item.product_id] = (restoreQty[item.product_id] || 0) + need;
        } else {
          restoreQty[item.product_id] = (restoreQty[item.product_id] || 0) + item.quantity;
        }
      }
      for (const item of order.items) {
        if (item.product_type !== 'combo') continue;
        const combo = products.find((p) => p.id === item.product_id);
        for (const child of combo?.combo_items || []) {
          restoreQty[child.product_id] = (restoreQty[child.product_id] || 0) + child.quantity * item.quantity;
        }
      }
      if (Object.keys(restoreQty).length > 0) {
        setProducts((prev) =>
          prev.map((p) => {
            const qty = restoreQty[p.id] || 0;
            if (qty > 0) {
              const nextStock = p.stock_quantity + qty;
              db.products.update(p.id, { stock_quantity: nextStock }).catch(console.warn);
              return { ...p, stock_quantity: nextStock };
            }
            return p;
          })
        );
      }

      // 2. Clamp/reverse customer debt
      if (order.debt_amount > 0 && order.customer_id) {
        setCustomers((prev) =>
          prev.map((c) => {
            if (c.id === order.customer_id) {
              const nextDebt = Math.max(0, c.current_debt - order.debt_amount);
              db.customers.update(c.id, { current_debt: nextDebt }).catch(console.warn);
              return { ...c, current_debt: nextDebt };
            }
            return c;
          })
        );
      }

      // 3. Refund payments to respective funds (FIN-ERR-05)
      // P1 sá»• quá»¹: RPC cancel_order Ä‘Ã£ ghi Ä‘áº£o server -> mirror Ä‘Ã¡nh dáº¥u synced.
      const cancelServerBacked = !!(serverId && supa && isOnline);
      for (const pmt of order.payments) {
        if (pmt.amount > 0) {
          const expenseEntry: CashbookEntry = {
            id: `cb-${Date.now()}-${pmt.method}`,
            code: generateOrderCode('PC'),
            type: 'expense',
            fund_type: pmt.method === 'cash' ? 'cash' : 'bank',
            category: 'other',
            amount: pmt.amount,
            reference_order_code: order.order_code,
            partner_name: order.customer_name,
            note: `HoÃ n tiá»n há»§y Ä‘Æ¡n hÃ ng ${order.order_code} qua quá»¹ ${pmt.method === 'cash' ? 'Tiá»n máº·t' : 'NgÃ¢n hÃ ng'}`,
            created_at: new Date().toISOString(),
            synced: cancelServerBacked || undefined,
          };
          setCashbook((prev) => [expenseEntry, ...prev]);
          db.cashbook.add(expenseEntry).catch(console.warn);
        }
      }

      // Update order status
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o))
      );
      await db.orders.update(orderId, { status: 'cancelled' });
      // ÄÆ¡n offline chÆ°a lÃªn server: gá»¡ khá»i hÃ ng Ä‘á»£i Ä‘á»ƒ khá»i replay Ä‘Æ¡n Ä‘Ã£ há»§y
      if (order.is_offline) {
        setPendingQueue((prev) => prev.filter((o) => o.id !== orderId));
        db.pendingOrders.delete(orderId).catch(() => {});
      }
      return true;
    },
    [orders, products, supa, user, currentShift, isOnline, resolveServerOrderId, setLoginOpen, setCustomers, setProducts]
  );

  // Return Order with Debt Clamping (FIN-ERR-03)
  const returnOrder = useCallback(
    async (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]): Promise<ReturnResult> => {
      const fail: ReturnResult = { ok: false, restocked: [], skipped: [] };
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi tráº£ hÃ ng!');
        setLoginOpen(true);
        return fail;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! KhÃ´ng Ä‘Æ°á»£c há»§y/tráº£ Ä‘Æ¡n sau khi káº¿t ca.');
        return fail;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order) return fail;
      // 0026: chá»‰ Ä‘Æ¡n hiá»‡u lá»±c má»›i tráº£ Ä‘Æ°á»£c (cháº·n tráº£ láº·p cáº£ khi gá»i trá»±c tiáº¿p hÃ m)
      if (order.status !== 'completed' && order.status !== 'deposit_order') {
        alert('ÄÆ¡n nÃ y Ä‘Ã£ há»§y/tráº£ rá»“i â€” khÃ´ng xá»­ lÃ½ láº·p.');
        return fail;
      }

      const totalRefundAmount = refundItems.reduce((sum, r) => sum + r.amount, 0);
      if (totalRefundAmount <= 0) return fail;

      // 0025: dá»±ng danh sÃ¡ch hoÃ n kho tá»« dÃ²ng tráº£ â€” goods hoÃ n Ä‘á»§ SL, combo rÃ£ BOM con,
      // area/service KHÃ”NG hoÃ n (hÃ ng Ä‘Ã£ cáº¯t/tiÃªu hao). Server cap theo SL Ä‘Ã£ bÃ¡n + tá»« chá»‘i
      // area/service ká»ƒ cáº£ khi bá»‹ gá»­i nháº§m.
      const restockReq = new Map<string, number>();
      const clientSkipped: ReturnSkipped[] = [];
      for (const rf of refundItems) {
        const line = order.items.find((it) => it.id === rf.itemId);
        if (!line || rf.quantity <= 0) continue;
        if (line.product_type === 'goods') {
          restockReq.set(line.sku, (restockReq.get(line.sku) || 0) + rf.quantity);
        } else if (line.product_type === 'combo') {
          const combo = products.find((p) => p.id === line.product_id);
          for (const child of combo?.combo_items || []) {
            restockReq.set(child.sku, (restockReq.get(child.sku) || 0) + child.quantity * rf.quantity);
          }
        } else {
          clientSkipped.push({ sku: line.sku, reason: line.product_type === 'area' ? 'hÃ ng cáº¯t theo kÃ­ch thÆ°á»›c, khÃ´ng nháº­p láº¡i' : 'dá»‹ch vá»¥, khÃ´ng nháº­p kho' });
        }
      }
      const pRestock = [...restockReq.entries()].map(([sku, quantity]) => ({ sku, quantity }));

      // 0024: Ä‘Æ¡n Ä‘Ã£ lÃªn server + online -> RPC return_order_items (server trá»« ná»£/hoÃ n tiá»n/
      // hoÃ n kho, local mirror theo Ä‘Ãºng sá»‘ server tráº£ vá»). ÄÆ¡n server mÃ  offline -> CHáº¶N.
      const serverId = await resolveServerOrderId(order);
      if (serverId && !isOnline) {
        alert('ÄÆ¡n nÃ y Ä‘Ã£ Ä‘á»“ng bá»™ server nhÆ°ng Ä‘ang ngoáº¡i tuyáº¿n â€” khÃ´ng thá»ƒ tráº£ hÃ ng lÃºc nÃ y Ä‘á»ƒ trÃ¡nh lá»‡ch ná»£. HÃ£y online rá»“i thá»­ láº¡i.');
        return fail;
      }
      let srvDebtCut: number | null = null;
      let srvCashRefund: number | null = null;
      let srvRestocked: RestockLine[] = [];
      let srvSkipped: ReturnSkipped[] = [];
      if (serverId && supa) {
        try {
          const { data, error } = await supa.rpc('return_order_items', {
            p_order_id: serverId,
            p_refund: totalRefundAmount,
            p_restock: pRestock,
          });
          if (error) throw new Error(error.message);
          const cut = Number((data as any)?.debt_cut);
          const cash = Number((data as any)?.cash_refund);
          if (Number.isFinite(cut) && Number.isFinite(cash)) {
            srvDebtCut = cut;
            srvCashRefund = cash;
          }
          const rs = (data as any)?.restocked;
          if (Array.isArray(rs)) {
            srvRestocked = rs
              .filter((e: any) => typeof e?.sku === 'string' && Number.isFinite(Number(e?.quantity)))
              .map((e: any) => ({ sku: e.sku as string, quantity: Number(e.quantity) }));
          }
          const sk = (data as any)?.skipped;
          if (Array.isArray(sk)) {
            srvSkipped = sk
              .filter((e: any) => typeof e?.sku === 'string')
              .map((e: any) => ({ sku: e.sku as string, reason: String(e.reason || 'server tá»« chá»‘i') }));
          }
        } catch (err: any) {
          alert(`Tráº£ hÃ ng server tháº¥t báº¡i â€” giá»¯ nguyÃªn Ä‘Æ¡n Ä‘á»ƒ thá»­ láº¡i: ${vietnamizeError(err)}`);
          return fail;
        }
      }

      // Customer debt reduction with clamping (FIN-ERR-03) â€” mirror server khi cÃ³
      let cashRefund = srvCashRefund ?? totalRefundAmount;
      if (order.customer_id) {
        const customer = customers.find((c) => c.id === order.customer_id);
        const currentDebt = customer?.current_debt || 0;
        const debtDeduction = srvDebtCut ?? Math.min(totalRefundAmount, currentDebt);
        if (srvCashRefund == null) cashRefund = totalRefundAmount - debtDeduction;

        if (debtDeduction > 0) {
          setCustomers((prev) =>
            prev.map((c) => {
              if (c.id === order.customer_id) {
                const nextDebt = c.current_debt - debtDeduction;
                db.customers.update(c.id, { current_debt: nextDebt }).catch(console.warn);
                return { ...c, current_debt: nextDebt };
              }
              return c;
            })
          );
        }
      }

      // HoÃ n kho mirror (0025): online thÃ¬ theo Ä‘Ãºng restocked server Ä‘Ã£ cap, offline/local
      // thÃ¬ theo yÃªu cáº§u Ä‘Ã£ dá»±ng (tin caller, UI hiá»‡n chá»‰ tráº£ full Ä‘Æ¡n).
      const finalRestocked: RestockLine[] = serverId
        ? srvRestocked
        : pRestock.map((l) => ({ sku: l.sku, quantity: l.quantity }));
      const finalSkipped: ReturnSkipped[] = [...clientSkipped, ...srvSkipped];
      if (finalRestocked.length > 0) {
        setProducts((prev) =>
          prev.map((p) => {
            const line = finalRestocked.find((l) => l.sku === p.sku);
            if (line && line.quantity > 0) {
              const nextStock = Math.round((p.stock_quantity + line.quantity) * 1000) / 1000;
              db.products.update(p.id, { stock_quantity: nextStock }).catch(console.warn);
              return { ...p, stock_quantity: nextStock };
            }
            return p;
          })
        );
      }
      const restockNote =
        finalRestocked.length > 0
          ? ` + nháº­p láº¡i kho: ${finalRestocked.map((l) => `${l.sku} x${l.quantity}`).join(', ')}`
          : '';

      // Expense entry for cash refund surplus
      // P1 sá»• quá»¹: RPC return_order_items Ä‘Ã£ ghi chi server -> mirror Ä‘Ã¡nh dáº¥u synced.
      if (cashRefund > 0) {
        const expenseEntry: CashbookEntry = {
          id: `cb-${Date.now()}`,
          code: generateOrderCode('PC'),
          type: 'expense',
          fund_type: 'cash',
          category: 'other',
          amount: cashRefund,
          reference_order_code: order.order_code,
          partner_name: order.customer_name,
          note: `HoÃ n tiá»n tráº£ hÃ ng cho Ä‘Æ¡n ${order.order_code} (sau khi Ä‘Ã£ kháº¥u trá»« ná»£)${restockNote}`,
          created_at: new Date().toISOString(),
          synced: (serverId && supa && isOnline) || undefined,
        };
        setCashbook((prev) => [expenseEntry, ...prev]);
        db.cashbook.add(expenseEntry).catch(console.warn);
      }

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'returned' } : o))
      );
      await db.orders.update(orderId, { status: 'returned' });
      // ÄÆ¡n offline chÆ°a lÃªn server: gá»¡ khá»i hÃ ng Ä‘á»£i Ä‘á»ƒ khá»i replay Ä‘Æ¡n Ä‘Ã£ tráº£
      if (order.is_offline) {
        setPendingQueue((prev) => prev.filter((o) => o.id !== orderId));
        db.pendingOrders.delete(orderId).catch(() => {});
      }
      return { ok: true, restocked: finalRestocked, skipped: finalSkipped };
    },
    [orders, products, customers, supa, user, currentShift, isOnline, resolveServerOrderId, setLoginOpen, setCustomers, setProducts]
  );

  // Collect Customer Debt (FIN-ERR-02)
  const collectDebt = useCallback(
    async (
      customerId: string,
      amount: number,
      paymentMethod: 'cash' | 'transfer',
      note: string
    ): Promise<boolean> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi thu ná»£!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! KhÃ´ng Ä‘Æ°á»£c thu ná»£ sau khi káº¿t ca. Vui lÃ²ng má»Ÿ ca má»›i (F12).');
        return false;
      }
      const customer = customers.find((c) => c.id === customerId);
      if (!customer || amount <= 0) return false;

      // 0024: KH Ä‘Ã£ link server + online -> RPC collect_debt (server clamp theo ná»£ tháº­t,
      // local mirror theo sá»‘ server tráº£ vá» + refresh truth). KH server mÃ  offline -> CHáº¶N.
      const serverCustId = customerMap[customerId] ?? null;
      if (serverCustId && !isOnline) {
        alert('KhÃ¡ch hÃ ng Ä‘Ã£ Ä‘á»“ng bá»™ server nhÆ°ng Ä‘ang ngoáº¡i tuyáº¿n â€” khÃ´ng thá»ƒ thu ná»£ lÃºc nÃ y Ä‘á»ƒ trÃ¡nh lá»‡ch cÃ´ng ná»£. HÃ£y online rá»“i thá»­ láº¡i.');
        return false;
      }
      let serverCollected: number | null = null;
      if (serverCustId && supa && user && isOnline) {
        try {
          const { data, error } = await supa.rpc('collect_debt', {
            p_customer_id: serverCustId,
            p_amount: amount,
            p_method: paymentMethod,
            p_note: note || null,
          });
          if (error) throw new Error(error.message);
          const got = Number((data as any)?.collected);
          if (Number.isFinite(got)) serverCollected = got;
        } catch (err: any) {
          alert(`Thu ná»£ server tháº¥t báº¡i â€” giá»¯ nguyÃªn Ä‘á»ƒ thá»­ láº¡i: ${vietnamizeError(err)}`);
          return false;
        }
      }

      const actualCollect = serverCollected ?? Math.min(amount, customer.current_debt);
      if (actualCollect <= 0) {
        alert('KhÃ´ng cÃ²n ná»£ pháº£i thu (server bÃ¡o KH Ä‘Ã£ háº¿t ná»£).');
        return false;
      }
      const nextDebt = customer.current_debt - actualCollect;

      setCustomers((prev) =>
        prev.map((c) => (c.id === customerId ? { ...c, current_debt: nextDebt } : c))
      );
      await db.customers.update(customerId, { current_debt: nextDebt });

      const entry: CashbookEntry = {
        id: `cb-${Date.now()}`,
        code: generateOrderCode('PT'),
        type: 'receipt',
        fund_type: paymentMethod === 'cash' ? 'cash' : 'bank',
        category: 'debt_collection',
        amount: actualCollect,
        partner_name: customer.name,
        note: note || `Thu ná»£ khÃ¡ch hÃ ng ${customer.name} qua ${paymentMethod === 'cash' ? 'Tiá»n máº·t' : 'NgÃ¢n hÃ ng'}`,
        created_at: new Date().toISOString(),
        // P1 sá»• quá»¹: RPC collect_debt Ä‘Ã£ ghi thu server -> mirror Ä‘Ã¡nh dáº¥u synced
        synced: serverCollected != null || undefined,
      };

      setCashbook((prev) => [entry, ...prev]);
      await db.cashbook.add(entry);

      if (paymentMethod === 'cash') {
        setCurrentShift((prev) => {
          const updated = {
            ...prev,
            cash_sales: prev.cash_sales + actualCollect,
            expected_cash: prev.expected_cash + actualCollect,
          };
          db.shifts.put(updated).catch(console.warn);
          return updated;
        });
      }

      // Refresh ná»£ tháº­t tá»« server (local cÃ³ thá»ƒ lá»‡ch truth) â€” best-effort
      if (serverCustId && supa && isOnline) {
        try {
          const { data } = await supa.from('customers').select('current_debt').eq('id', serverCustId).maybeSingle();
          const truth = Number((data as { current_debt?: unknown } | null)?.current_debt);
          if (Number.isFinite(truth)) {
            setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, current_debt: truth } : c)));
            await db.customers.update(customerId, { current_debt: truth });
          }
        } catch {
          /* giá»¯ sá»‘ mirror */
        }
      }

      return true;
    },
    [customers, customerMap, isOnline, supa, user, currentShift, setLoginOpen, setCustomers]
  );

  // Äá»“ng bá»™ ná»£ KH tá»« server (0025+1): server lÃ  truth cÃ´ng ná»£ â€” sá»‘ local cÃ³ thá»ƒ cÅ© khi thu ná»£
  // á»Ÿ mÃ¡y khÃ¡c, sá»­a tay trÃªn Dashboard, hoáº·c sync giÃ¡n Ä‘oáº¡n. KÃ©o batch theo uuid Ä‘Ã£ map,
  // ghi Ä‘Ã¨ current_debt (+debt_limit) local + Dexie. KH chÆ°a link (khÃ¡ch láº», mÃ¡y khÃ¡c táº¡o)
  // Ä‘Æ°á»£c bá» qua â€” Ä‘áº¿m vÃ o skipped Ä‘á»ƒ UI bÃ¡o rÃµ.
  const syncDebtsFromServer = useCallback(async (): Promise<{ updated: number; skipped: number }> => {
    if (!supa || !user) {
      alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi Ä‘á»“ng bá»™ cÃ´ng ná»£!');
      setLoginOpen(true);
      return { updated: 0, skipped: 0 };
    }
    if (!isOnline) {
      alert('Äang ngoáº¡i tuyáº¿n â€” khÃ´ng thá»ƒ Ä‘á»“ng bá»™ cÃ´ng ná»£. HÃ£y online rá»“i thá»­ láº¡i.');
      return { updated: 0, skipped: 0 };
    }
    const linked = customers.filter((c) => c.id !== 'cust-1' && customerMap[c.id]);
    const skipped = customers.length - linked.length;
    if (linked.length === 0) return { updated: 0, skipped };
    try {
      // Äáº£o map uuid server -> id local
      const byUuid = new Map<string, string>();
      for (const c of linked) byUuid.set(customerMap[c.id], c.id);
      const truth = new Map<string, { debt: number; limit: number }>();
      // Chia lÃ´ 100 uuid Ä‘á»ƒ URL REST khÃ´ng quÃ¡ dÃ i
      for (let i = 0; i < linked.length; i += 100) {
        const batch = linked.slice(i, i + 100).map((c) => customerMap[c.id]);
        const { data, error } = await supa
          .from('customers')
          .select('id,current_debt,debt_limit')
          .in('id', batch);
        if (error) throw new Error(error.message);
        for (const row of (data as any[]) || []) {
          truth.set(row.id, {
            debt: Math.max(0, Number(row.current_debt) || 0),
            limit: Math.max(0, Number(row.debt_limit) || 0),
          });
        }
      }
      let updated = 0;
      const next = new Map<string, { debt: number; limit: number }>();
      for (const [uuid, t] of truth) {
        const localId = byUuid.get(uuid);
        if (localId) {
          next.set(localId, t);
          updated += 1;
        }
      }
      if (updated > 0) {
        setCustomers((prev) =>
          prev.map((c) => {
            const t = next.get(c.id);
            if (!t) return c;
            if (c.current_debt === t.debt && c.debt_limit === t.limit) return c;
            db.customers.update(c.id, { current_debt: t.debt, debt_limit: t.limit }).catch(console.warn);
            return { ...c, current_debt: t.debt, debt_limit: t.limit };
          })
        );
      }
      return { updated, skipped };
    } catch (err: any) {
      alert(`Äá»“ng bá»™ cÃ´ng ná»£ tháº¥t báº¡i: ${vietnamizeError(err)}`);
      return { updated: 0, skipped };
    }
  }, [supa, user, isOnline, customers, customerMap, setLoginOpen, setCustomers]);

  // P0: quÃ©t hÃ ng Ä‘á»£i kho/quá»¹/NCC â€” FIFO khi online. Server dedupe báº±ng client_ref
  // nÃªn replay an toÃ n; supplier_payment cÃ²n kÃ©o truth ná»£ vá» mirror nhÆ° thu ná»£ KH.
  const syncPendingOps = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!supa || !user || !isOnline) return { synced: 0, failed: 0 };
    const pendings = await db.pendingOps
      .where('status')
      .equals('pending')
      .sortBy('created_at')
      .catch(() => [] as PendingOp[]);
    let synced = 0;
    let failed = 0;
    for (const op of pendings) {
      try {
        if (op.kind === 'import') {
          const p = op.payload as {
            clientRef: string;
            code: string;
            supplierName: string;
            total: number;
            lines: { productId: string; sku: string; quantity: number; importPrice: number }[];
          };
          const { error } = await supa.rpc('sync_stock_import', {
            p_client_ref: p.clientRef,
            p_code: p.code,
            p_supplier_id: null,
            p_supplier_name: p.supplierName,
            p_lines: p.lines.map((l) => ({
              sku: l.sku,
              product_id: asUuidOrNull(l.productId),
              quantity: l.quantity,
              import_price: l.importPrice,
            })),
            p_total: p.total,
          });
          if (error) throw error;
        } else if (op.kind === 'voucher') {
          const p = op.payload as {
            entryId: string;
            type: string;
            fund: string;
            category: string;
            amount: number;
            partner: string;
            reference: string;
            note: string;
          };
          const { error } = await supa.rpc('record_cashbook_voucher', {
            p_client_ref: p.entryId,
            p_type: p.type,
            p_fund_type: p.fund,
            p_category: p.category,
            p_amount: p.amount,
            p_partner_name: p.partner || null,
            p_reference: p.reference || null,
            p_note: p.note || null,
          });
          if (error) throw error;
          await db.cashbook.update(p.entryId, { synced: true }).catch(() => {});
          setCashbook((prev) => prev.map((e) => (e.id === p.entryId ? { ...e, synced: true } : e)));
        } else {
          const p = op.payload as {
            supplierId: string;
            amount: number;
            method: string;
            note: string;
            entryId: string;
          };
          const supplier = suppliers.find((s) => s.id === p.supplierId);
          const serverSid = supplier ? asUuidOrNull(supplier.id) : null;
          if (!serverSid) continue; // NCC chÆ°a Ä‘á»“ng bá»™ master -> giá»¯ hÃ ng Ä‘á»£i
          const { data, error } = await supa.rpc('pay_supplier_debt', {
            p_client_ref: p.entryId,
            p_supplier_id: serverSid,
            p_amount: p.amount,
            p_method: p.method,
            p_note: p.note || null,
          });
          if (error) throw error;
          // Mirror truth ná»£ NCC tá»« server (server clamp theo ná»£ tháº­t)
          try {
            const { data: srow } = await supa
              .from('suppliers')
              .select('current_debt')
              .eq('id', serverSid)
              .maybeSingle();
            const truth = Number((srow as { current_debt?: unknown } | null)?.current_debt);
            if (Number.isFinite(truth)) {
              setSuppliers((prev) =>
                prev.map((s) => (s.id === p.supplierId ? { ...s, current_debt: truth } : s))
              );
              await db.suppliers.update(p.supplierId, { current_debt: truth });
            }
          } catch {
            /* giá»¯ sá»‘ mirror */
          }
          await db.cashbook.update(p.entryId, { synced: true }).catch(() => {});
          setCashbook((prev) => prev.map((e) => (e.id === p.entryId ? { ...e, synced: true } : e)));
          void data;
        }
        await db.pendingOps.delete(op.id);
        synced += 1;
      } catch (err) {
        const attempts = op.attempts + 1;
        await db.pendingOps
          .update(op.id, {
            attempts,
            status: attempts >= 10 ? 'failed' : 'pending',
            last_error: err instanceof Error ? err.message : String(err),
          })
          .catch(() => {});
        if (attempts >= 10) failed += 1;
      }
    }
    return { synced, failed };
  }, [supa, user, isOnline, suppliers, setSuppliers, setCashbook]);

  // Master Data Add/Update hÃ ng hÃ³a/KH/NCC sá»‘ng á»Ÿ CatalogProvider (useCatalog) â€”
  // á»Ÿ Ä‘Ã¢y chá»‰ cÃ²n nghiá»‡p vá»¥ chi tráº£ NCC (Ä‘á»¥ng sá»• quá»¹ -> thuá»™c táº§ng Transactions).
  const paySupplierDebt = useCallback(
    async (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string): Promise<boolean> => {
      // P2: thu ngÃ¢n/worker khÃ´ng Ä‘Æ°á»£c chi tráº£ NCC
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chá»‰ Admin/Quáº£n lÃ½ Ä‘Æ°á»£c chi tráº£ ná»£ NCC!');
        return false;
      }
      const supplier = suppliers.find((s) => s.id === supplierId);
      if (!supplier || amount <= 0) return false;

      const newDebt = Math.max(0, supplier.current_debt - amount);
      setSuppliers((prev) => prev.map((s) => (s.id === supplierId ? { ...s, current_debt: newDebt } : s)));
      await db.suppliers.update(supplierId, { current_debt: newDebt });

      const expenseEntry: CashbookEntry = {
        id: `cb-${Date.now()}-suppay`,
        code: generateOrderCode('PC'),
        type: 'expense',
        fund_type: paymentMethod === 'cash' ? 'cash' : 'bank',
        category: 'supplier_payment',
        amount,
        partner_name: supplier.name,
        note: `Chi tráº£ ná»£ NCC ${supplier.name}: ${note}`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      await db.cashbook.add(expenseEntry);
      // P0: xáº¿p hÃ ng Ä‘áº©y tráº£ NCC lÃªn server (clamp + truth á»Ÿ sweep); online thÃ¬ Ä‘áº©y ngay
      await enqueueOp('supplier_payment', {
        supplierId,
        amount,
        method: paymentMethod,
        note,
        entryId: expenseEntry.id,
      });
      void syncPendingOps();
      return true;
    },
    [suppliers, supa, profile, setSuppliers, syncPendingOps]
  );

  // TÃ­nh láº¡i tá»•ng cÃ´ng trÃ¬nh tá»« dÃ²ng (mirror cÃ´ng thá»©c P&L á»Ÿ ProjectsView)
  const recalcProjectTotals = (p: Project): Project => {
    const material_cost_total = p.materials.reduce((s, m) => s + (m.total_cost || 0), 0);
    const labor_cost_total = p.workers.reduce((s, w) => s + (w.total_wage || 0), 0);
    const total_cost = material_cost_total + labor_cost_total + (p.other_costs || 0);
    return {
      ...p,
      material_cost_total,
      labor_cost_total,
      total_cost,
      actual_profit: (p.settled_revenue || 0) - total_cost,
    };
  };

  // ---- Äá»“ng bá»™ Dá»± Ã¡n/CÃ´ng trÃ¬nh 2 chiá»u (migration 0040) ----
  // Local-first: id `proj-...` = chÆ°a Ä‘áº©y; sau khi Ä‘áº©y gáº¯n server_id, giá»¯ id local
  // á»•n Ä‘á»‹nh cho UI. Server tháº¯ng khi kÃ©o, trá»« báº£n local chÆ°a tá»«ng Ä‘áº©y.

  // Äáº©y 1 cÃ´ng trÃ¬nh: header upsert trá»±c tiáº¿p + dÃ²ng váº­t tÆ°/thá»£ qua RPC
  // sync_project_workspace (delta tá»“n kho, cháº¡y láº¡i khÃ´ng trá»« 2 láº§n).
  // Giá»¯ id local á»•n Ä‘á»‹nh cho UI, chá»‰ gáº¯n server_id (mirror customerMap).
  // Lá»—i máº¡ng/quyá»n -> warn + giá»¯ local, tráº£ null.
  const pushProjectToServer = useCallback(
    async (project: Project): Promise<Project | null> => {
      if (!supa || !user || !isOnline) return null;
      try {
        let serverId = asUuidOrNull(project.server_id) ?? asUuidOrNull(project.id);
        const header = {
          code: project.code,
          name: project.name,
          customer_id: customerMap[project.customer_id] ?? asUuidOrNull(project.customer_id),
          customer_name: project.customer_name,
          address: project.address,
          phase: project.phase,
          estimated_revenue: Math.round(project.estimated_revenue || 0),
          settled_revenue: Math.round(project.settled_revenue || 0),
          deposit_amount: Math.round(project.deposit_amount || 0),
          other_costs: Math.round(project.other_costs || 0),
          status: project.status,
        };
        if (serverId) {
          const { error } = await supa.from('projects').update(header).eq('id', serverId);
          if (error) throw error;
        } else {
          const { data, error } = await supa.from('projects').insert(header).select('id').single();
          if (error) {
            // MÃ£ CT Ä‘Ã£ tá»“n táº¡i (Ä‘áº©y tá»« mÃ¡y khÃ¡c) -> dÃ¹ng báº£n server rá»“i update
            if ((error as { code?: string }).code === '23505') {
              const existing = await supa.from('projects').select('id').eq('code', project.code).single();
              if (existing.error || !existing.data) throw error;
              serverId = existing.data.id as string;
              const { error: upErr } = await supa.from('projects').update(header).eq('id', serverId as string);
              if (upErr) throw upErr;
            } else {
              throw error;
            }
          } else {
            serverId = data.id as string;
          }
        }
        const { error: rpcError } = await supa.rpc('sync_project_workspace', {
          p_project_id: serverId as string,
          p_materials: project.materials.map((m) => ({
            product_id: asUuidOrNull(m.product_id),
            sku: m.sku,
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            unit_cost: Math.round(m.unit_cost || 0),
          })),
          p_workers: project.workers.map((w) => ({
            employee_id: asUuidOrNull(w.employee_id),
            employee_code: w.employee_code ?? null,
            worker_name: w.worker_name,
            role: w.role,
            days_worked: w.days_worked,
            daily_wage: Math.round(w.daily_wage || 0),
            allowance: Math.round(w.allowance || 0),
          })),
        });
        if (rpcError) throw rpcError;
        // Gáº¯n server_id vÃ o báº£n local (giá»¯ nguyÃªn id cho UI Ä‘ang cáº§m)
        if (project.server_id !== serverId) {
          await db.projects.update(project.id, { server_id: serverId as string }).catch(() => {});
          setProjects((prev) =>
            prev.map((p) => (p.id === project.id ? { ...p, server_id: serverId as string } : p))
          );
          return { ...project, server_id: serverId as string };
        }
        return project;
      } catch (err) {
        console.warn('Project push failed (giá»¯ local):', err);
        return null;
      }
    },
    [supa, user, isOnline, customerMap]
  );

  // KÃ©o cÃ´ng trÃ¬nh tá»« server (server tháº¯ng), giá»¯ báº£n local chÆ°a tá»«ng Ä‘áº©y.
  const refreshServerProjects = useCallback(async (): Promise<boolean> => {
    if (!supa || !user) return false;
    try {
      const [projRes, matRes, workRes] = await Promise.all([
        supa.from('projects').select('*').order('code'),
        supa.from('project_materials').select('*'),
        supa.from('project_workers').select('*'),
      ]);
      if (projRes.error || matRes.error || workRes.error) return false;
      const matsByProject = new Map<string, unknown[]>();
      for (const m of ((matRes.data || []) as Record<string, unknown>[])) {
        const pid = String(m.project_id || '');
        if (!matsByProject.has(pid)) matsByProject.set(pid, []);
        matsByProject.get(pid)?.push(m);
      }
      const worksByProject = new Map<string, unknown[]>();
      for (const w of ((workRes.data || []) as Record<string, unknown>[])) {
        const pid = String(w.project_id || '');
        if (!worksByProject.has(pid)) worksByProject.set(pid, []);
        worksByProject.get(pid)?.push(w);
      }
      const serverToLocalCustomer = new Map(
        Object.entries(customerMap).map(([localId, serverId]) => [serverId, localId])
      );
      const num = (v: unknown) => Number(v) || 0;
      const mapped: Project[] = ((projRes.data || []) as Record<string, unknown>[]).map((row) => {
        const materials: ProjectMaterial[] = (matsByProject.get(String(row.id)) || []).map((rm) => {
          const r = rm as Record<string, unknown>;
          const qty = num(r.quantity);
          const unitCost = num(r.unit_cost);
          return {
            product_id: typeof r.product_id === 'string' ? r.product_id : '',
            sku: typeof r.sku === 'string' ? r.sku : '',
            name: typeof r.name === 'string' && r.name ? r.name : 'Váº­t tÆ°',
            quantity: qty,
            unit: typeof r.unit === 'string' ? r.unit : '',
            unit_cost: Math.round(unitCost),
            total_cost: Math.round(qty * unitCost),
          };
        });
        const workers: ProjectWorker[] = (worksByProject.get(String(row.id)) || []).map((rw) => {
          const r = rw as Record<string, unknown>;
          const days = num(r.days_worked);
          const wage = Math.round(num(r.daily_wage));
          const allow = Math.round(num(r.allowance));
          return {
            id: String(r.id),
            employee_id: typeof r.employee_id === 'string' ? r.employee_id : undefined,
            employee_code: typeof r.employee_code === 'string' ? r.employee_code : undefined,
            worker_name: typeof r.worker_name === 'string' ? r.worker_name : '',
            role: typeof r.role === 'string' && r.role ? r.role : 'Thá»£',
            days_worked: days,
            daily_wage: wage,
            allowance: allow,
            total_wage: Math.round(days * wage + allow),
          };
        });
        const serverCustomerId = typeof row.customer_id === 'string' ? row.customer_id : '';
        const base: Project = {
          id: String(row.id),
          code: typeof row.code === 'string' ? row.code : '',
          name: typeof row.name === 'string' ? row.name : '',
          customer_id: (serverCustomerId && serverToLocalCustomer.get(serverCustomerId)) || serverCustomerId,
          customer_name: typeof row.customer_name === 'string' ? row.customer_name : '',
          address: typeof row.address === 'string' ? row.address : '',
          phase: row.phase === 2 ? 2 : row.phase === 3 ? 3 : 1,
          estimated_revenue: Math.round(num(row.estimated_revenue)),
          settled_revenue: Math.round(num(row.settled_revenue)),
          deposit_amount: Math.round(num(row.deposit_amount)),
          materials,
          workers,
          other_costs: Math.round(num(row.other_costs)),
          material_cost_total: 0,
          labor_cost_total: 0,
          total_cost: 0,
          actual_profit: 0,
          status:
            row.status === 'completed' || row.status === 'in_progress'
              ? row.status
              : 'planning',
          created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        };
        return recalcProjectTotals(base);
      });
      const localRows = await db.projects.toArray().catch(() => [] as Project[]);
      const localByServerId = new Map(
        localRows.filter((p) => p.server_id).map((p) => [p.server_id as string, p])
      );
      const withLocalIds = mapped.map((m) => {
        const local = localByServerId.get(m.id);
        return { ...m, id: local ? local.id : m.id, server_id: m.id };
      });
      const pushedCodes = new Set(withLocalIds.map((m) => m.code));
      const neverPushed = localRows.filter((p) => !p.server_id && !pushedCodes.has(p.code));
      const next = [...withLocalIds, ...neverPushed];
      setProjects(next);
      await db.projects.clear().catch(() => {});
      await db.projects.bulkAdd(next).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Project pull failed (giá»¯ local):', err);
      return false;
    }
  }, [supa, user, customerMap]);

  // Äá»“ng bá»™ Ä‘áº§y Ä‘á»§ khi online: kÃ©o trÆ°á»›c, Ä‘áº©y ná»‘t báº£n local chÆ°a lÃªn.
  const syncProjects = useCallback(async (): Promise<void> => {
    if (!supa || !user || !isOnline) return;
    await refreshServerProjects();
    const locals = await db.projects.toArray().catch(() => [] as Project[]);
    for (const p of locals.filter((x) => !x.server_id)) {
      await pushProjectToServer(p);
    }
  }, [supa, user, isOnline, refreshServerProjects, pushProjectToServer]);

  const addProject = useCallback(
    async (data: Omit<Project, 'id' | 'code'>): Promise<Project> => {
      const code = generateOrderCode('CT');
      const newProj: Project = {
        ...data,
        id: `proj-${Date.now()}`,
        code,
      };
      setProjects((prev) => [...prev, newProj]);
      await db.projects.add(newProj);
      // Äáº©y lÃªn server Ä‘á»ƒ remap id local -> uuid (tháº¥t báº¡i váº«n giá»¯ local)
      const synced = await pushProjectToServer(newProj);
      return synced ?? newProj;
    },
    [pushProjectToServer]
  );

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    await db.projects.update(id, updates);
    const row = await db.projects.get(id).catch(() => undefined);
    if (row) void pushProjectToServer(row as Project);
  }, [pushProjectToServer]);

  // Phase 2: xuáº¥t váº­t tÆ° cho cÃ´ng trÃ¬nh â€” trá»« tá»“n kho tháº­t + tháº» kho export_project.
  // Chá»‰ hÃ ng goods/area (service/combo cháº·n); Ä‘Æ¡n giÃ¡ vá»‘n = avg_cost hiá»‡n táº¡i.
  const exportProjectMaterial = useCallback(
    async (projectId: string, productId: string, quantity: number): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi xuáº¥t váº­t tÆ°!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! Má»Ÿ ca má»›i (F12) trÆ°á»›c khi xuáº¥t váº­t tÆ° cho cÃ´ng trÃ¬nh.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      const product = products.find((x) => x.id === productId);
      if (!product) return null;
      if (product.product_type === 'service' || product.product_type === 'combo') {
        alert('HÃ ng dá»‹ch vá»¥/combo khÃ´ng xuáº¥t trá»±c tiáº¿p cho cÃ´ng trÃ¬nh! Chá»n hÃ ng hÃ³a hoáº·c hÃ ng diá»‡n tÃ­ch.');
        return null;
      }
      if (!(quantity > 0)) {
        alert('Sá»‘ lÆ°á»£ng xuáº¥t pháº£i lá»›n hÆ¡n 0!');
        return null;
      }
      if (product.stock_quantity < quantity) {
        alert(`Tá»“n kho khÃ´ng Ä‘á»§: ${product.sku} (tá»“n ${product.stock_quantity} ${product.unit}, cáº§n ${quantity}).`);
        return null;
      }
      const unit_cost = product.avg_cost || 0;
      const line: ProjectMaterial = {
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        quantity,
        unit: product.unit,
        unit_cost,
        total_cost: Math.round(quantity * unit_cost),
      };
      const nextStock = Math.round((product.stock_quantity - quantity) * 1000) / 1000;
      setProducts((prev) => prev.map((x) => (x.id === productId ? { ...x, stock_quantity: nextStock } : x)));
      db.products.update(productId, { stock_quantity: nextStock }).catch(console.warn);
      const movement: StockMovement = {
        id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        reference_code: project.code,
        product_id: product.id,
        product_name: product.name,
        movement_type: 'export_project',
        quantity: -quantity,
        previous_stock: product.stock_quantity,
        new_stock: nextStock,
        note: `Xuáº¥t cho cÃ´ng trÃ¬nh ${project.code} (${project.name})`,
        created_at: new Date().toISOString(),
      };
      setStockMovements((prev) => [movement, ...prev]);
      const updated = recalcProjectTotals({ ...project, materials: [...project.materials, line] });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        materials: updated.materials,
        material_cost_total: updated.material_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      return updated;
    },
    [projects, products, supa, user, currentShift, setLoginOpen, setProducts]
  );

  // Phase 2 (batch): xuáº¥t 1 phiáº¿u nhiá»u dÃ²ng â€” validate háº¿t trÆ°á»›c, 1 láº§n trá»« kho + 1 láº§n chá»‘t Ä‘Æ¡n
  const exportProjectMaterialBatch = useCallback(
    async (projectId: string, lines: { productId: string; quantity: number }[]): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi xuáº¥t váº­t tÆ°!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! Má»Ÿ ca má»›i (F12) trÆ°á»›c khi xuáº¥t váº­t tÆ° cho cÃ´ng trÃ¬nh.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      // Gá»™p dÃ²ng trÃ¹ng + validate toÃ n phiáº¿u trÆ°á»›c khi trá»« (1 dÃ²ng lá»—i -> há»§y cáº£ phiáº¿u)
      const merged = new Map<string, number>();
      for (const l of lines) merged.set(l.productId, (merged.get(l.productId) || 0) + (l.quantity || 0));
      const errors: string[] = [];
      const items: { product: Product; quantity: number }[] = [];
      for (const [pid, qty] of merged) {
        const product = products.find((x) => x.id === pid);
        if (!product) {
          errors.push('Máº·t hÃ ng khÃ´ng tá»“n táº¡i trong kho.');
          continue;
        }
        if (product.product_type === 'service' || product.product_type === 'combo') {
          errors.push(`${product.sku}: dá»‹ch vá»¥/combo khÃ´ng xuáº¥t trá»±c tiáº¿p.`);
          continue;
        }
        if (!(qty > 0)) {
          errors.push(`${product.sku}: sá»‘ lÆ°á»£ng pháº£i lá»›n hÆ¡n 0.`);
          continue;
        }
        if (product.stock_quantity < qty) {
          errors.push(`${product.sku}: tá»“n ${product.stock_quantity} ${product.unit}, cáº§n ${qty}.`);
          continue;
        }
        items.push({ product, quantity: qty });
      }
      if (items.length === 0) {
        alert('Phiáº¿u xuáº¥t chÆ°a cÃ³ dÃ²ng há»£p lá»‡!' + (errors.length > 0 ? `\n${errors.join('\n')}` : ''));
        return null;
      }
      if (errors.length > 0) {
        alert(`Phiáº¿u cÃ³ dÃ²ng lá»—i, chÆ°a xuáº¥t:\n${errors.join('\n')}`);
        return null;
      }
      const now = new Date().toISOString();
      const newLines: ProjectMaterial[] = [];
      const movements: StockMovement[] = [];
      const stockAfter = new Map(products.map((p) => [p.id, p.stock_quantity]));
      for (const { product, quantity } of items) {
        const prevStock = stockAfter.get(product.id) || 0;
        const nextStock = Math.round((prevStock - quantity) * 1000) / 1000;
        stockAfter.set(product.id, nextStock);
        newLines.push({
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
          unit: product.unit,
          unit_cost: product.avg_cost || 0,
          total_cost: Math.round(quantity * (product.avg_cost || 0)),
        });
        movements.push({
          id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          reference_code: project.code,
          product_id: product.id,
          product_name: product.name,
          movement_type: 'export_project',
          quantity: -quantity,
          previous_stock: prevStock,
          new_stock: nextStock,
          note: `Xuáº¥t cho cÃ´ng trÃ¬nh ${project.code} (${project.name})`,
          created_at: now,
        });
      }
      setProducts((prev) =>
        prev.map((x) => {
          const ns = stockAfter.get(x.id);
          if (ns !== undefined && ns !== x.stock_quantity) {
            db.products.update(x.id, { stock_quantity: ns }).catch(console.warn);
            return { ...x, stock_quantity: ns };
          }
          return x;
        })
      );
      setStockMovements((prev) => [...movements.reverse(), ...prev]);
      const updated = recalcProjectTotals({ ...project, materials: [...project.materials, ...newLines] });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        materials: updated.materials,
        material_cost_total: updated.material_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      return updated;
    },
    [projects, products, supa, user, currentShift, setLoginOpen, setProducts]
  );

  // Phase 3: Ä‘Æ°a chi phÃ­ nhÃ¢n cÃ´ng vÃ o cÃ´ng trÃ¬nh (thá»£ láº¥y tá»« há»“ sÆ¡ nhÃ¢n sá»±, link employee_id)
  const addProjectWorker = useCallback(
    async (
      projectId: string,
      worker: { worker_name: string; role: string; days_worked: number; daily_wage: number; allowance: number; employee_id?: string; employee_code?: string }
    ): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi thÃªm thá»£!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (!worker.worker_name.trim()) {
        alert('Vui lÃ²ng nháº­p tÃªn thá»£!');
        return null;
      }
      if (!(worker.days_worked > 0)) {
        alert('Sá»‘ ngÃ y cÃ´ng pháº£i lá»›n hÆ¡n 0!');
        return null;
      }
      const line: ProjectWorker = {
        id: `pw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        employee_id: worker.employee_id || undefined,
        employee_code: worker.employee_code || undefined,
        worker_name: worker.worker_name.trim(),
        role: worker.role.trim() || 'Thá»£',
        days_worked: worker.days_worked,
        daily_wage: Math.max(0, Math.round(worker.daily_wage)),
        allowance: Math.max(0, Math.round(worker.allowance)),
        total_wage: 0,
      };
      line.total_wage = Math.round(line.days_worked * line.daily_wage + line.allowance);
      // TrÃ¹ng thá»£ (cÃ¹ng mÃ£ NV, hoáº·c thá»£ ngoÃ i cÃ¹ng tÃªn+viá»‡c+lÆ°Æ¡ng) -> cá»™ng dá»“n ngÃ y cÃ´ng
      // vÃ o dÃ²ng cÅ© thay vÃ¬ tÃ¡ch dÃ²ng má»›i
      const dupIdx = project.workers.findIndex((w) =>
        line.employee_id
          ? w.employee_id === line.employee_id
          : !w.employee_id &&
            w.worker_name.trim().toLowerCase() === line.worker_name.trim().toLowerCase() &&
            w.role === line.role &&
            w.daily_wage === line.daily_wage
      );
      const workers =
        dupIdx >= 0
          ? project.workers.map((w, i) => {
              if (i !== dupIdx) return w;
              const days_worked = Math.round((w.days_worked + line.days_worked) * 1000) / 1000;
              return {
                ...w,
                days_worked,
                allowance: Math.max(w.allowance, line.allowance),
                total_wage: Math.round(days_worked * w.daily_wage + Math.max(w.allowance, line.allowance)),
              };
            })
          : [...project.workers, line];
      const updated = recalcProjectTotals({ ...project, workers });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        workers: updated.workers,
        labor_cost_total: updated.labor_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, supa, user, setLoginOpen, pushProjectToServer]
  );

  // Sá»­a sá»‘ tÃ i chÃ­nh (dá»± toÃ¡n/quyáº¿t toÃ¡n/chi khÃ¡c Ä‘á»™c láº­p nhau) + tÃ­nh láº¡i lÃ£i
  const updateProjectFinance = useCallback(
    async (
      projectId: string,
      finance: { estimated_revenue?: number; settled_revenue?: number; other_costs?: number }
    ): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi sá»­a cÃ´ng trÃ¬nh!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      const patch: Partial<Project> = {};
      if (finance.estimated_revenue !== undefined)
        patch.estimated_revenue = Math.max(0, Math.round(finance.estimated_revenue));
      if (finance.settled_revenue !== undefined)
        patch.settled_revenue = Math.max(0, Math.round(finance.settled_revenue));
      if (finance.other_costs !== undefined) patch.other_costs = Math.max(0, Math.round(finance.other_costs));
      const updated = recalcProjectTotals({ ...project, ...patch });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        estimated_revenue: updated.estimated_revenue,
        settled_revenue: updated.settled_revenue,
        other_costs: updated.other_costs,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, supa, user, setLoginOpen, pushProjectToServer]
  );

  // Thu cá»c/táº¡m á»©ng chá»§ Ä‘áº§u tÆ°: phiáº¿u thu deposit theo mÃ£ CT + cá»™ng dá»“n deposit_amount.
  // (Cá»c khÃ´ng trá»« vÃ o lÃ£i â€” lÃ£i = quyáº¿t toÃ¡n âˆ’ tá»•ng chi; cÃ²n pháº£i thu = quyáº¿t toÃ¡n âˆ’ Ä‘Ã£ cá»c.)
  const collectProjectDeposit = useCallback(
    async (projectId: string, amount: number, paymentMethod: 'cash' | 'transfer'): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi thu cá»c!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! Má»Ÿ ca má»›i (F12) trÆ°á»›c khi thu cá»c cÃ´ng trÃ¬nh.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project || !(amount > 0)) return null;
      const entry: CashbookEntry = {
        id: `cb-${Date.now()}-projdep`,
        code: generateOrderCode('PT'),
        type: 'receipt',
        fund_type: paymentMethod === 'cash' ? 'cash' : 'bank',
        category: 'deposit',
        amount: Math.round(amount),
        reference_order_code: project.code,
        partner_name: project.customer_name,
        note: `Thu cá»c cÃ´ng trÃ¬nh ${project.code} (${project.name})`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [entry, ...prev]);
      db.cashbook.add(entry).catch(console.warn);
      if (paymentMethod === 'cash') {
        setCurrentShift((prev) => {
          const updatedShift: Shift = {
            ...prev,
            cash_sales: prev.cash_sales + Math.round(amount),
            expected_cash: prev.expected_cash + Math.round(amount),
          };
          db.shifts.put(updatedShift).catch(console.warn);
          return updatedShift;
        });
      }
      const updated: Project = {
        ...project,
        deposit_amount: (project.deposit_amount || 0) + Math.round(amount),
      };
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, { deposit_amount: updated.deposit_amount });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, supa, user, currentShift, setLoginOpen, pushProjectToServer]
  );
  const removeProjectLine = useCallback(
    async (projectId: string, kind: 'material' | 'worker', lineKey: string): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi sá»­a cÃ´ng trÃ¬nh!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (kind === 'material') {
        if (currentShift.status !== 'open') {
          alert('Ca Ä‘Ã£ Ä‘Ã³ng! Má»Ÿ ca má»›i (F12) trÆ°á»›c khi hoÃ n váº­t tÆ° vá» kho.');
          return null;
        }
        const idx = Number(lineKey);
        const line = project.materials[idx];
        if (!line) return null;
        const product = products.find((x) => x.id === line.product_id);
        if (product) {
          const nextStock = Math.round((product.stock_quantity + line.quantity) * 1000) / 1000;
          setProducts((prev) => prev.map((x) => (x.id === product.id ? { ...x, stock_quantity: nextStock } : x)));
          db.products.update(product.id, { stock_quantity: nextStock }).catch(console.warn);
          const movement: StockMovement = {
            id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            reference_code: project.code,
            product_id: product.id,
            product_name: product.name,
            movement_type: 'return',
            quantity: line.quantity,
            previous_stock: product.stock_quantity,
            new_stock: nextStock,
            note: `HoÃ n váº­t tÆ° tá»« cÃ´ng trÃ¬nh ${project.code} (${project.name})`,
            created_at: new Date().toISOString(),
          };
          setStockMovements((prev) => [movement, ...prev]);
        }
      const updated = recalcProjectTotals({
        ...project,
        materials: project.materials.filter((_, i) => i !== idx),
      });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        materials: updated.materials,
        material_cost_total: updated.material_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
      }
      const updated = recalcProjectTotals({
        ...project,
        workers: project.workers.filter((w) => w.id !== lineKey),
      });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        workers: updated.workers,
        labor_cost_total: updated.labor_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, products, supa, user, currentShift, setLoginOpen, setProducts, pushProjectToServer]
  );

  const closeShift = useCallback(
    async (countedCash: number): Promise<boolean> => {
      // Fix thu ngÃ¢n: báº¯t buá»™c Ä‘Äƒng nháº­p + ca Ä‘ang má»Ÿ má»›i Ä‘Æ°á»£c káº¿t ca.
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p thu ngÃ¢n trÆ°á»›c khi káº¿t ca!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('KhÃ´ng cÃ³ ca Ä‘ang má»Ÿ! Ca nÃ y Ä‘Ã£ Ä‘Æ°á»£c káº¿t trÆ°á»›c Ä‘Ã³.');
        return false;
      }
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        alert('Sá»‘ tiá»n kiá»ƒm Ä‘áº¿m khÃ´ng há»£p lá»‡!');
        return false;
      }
      // Gáº¯n ca vá»›i ngÆ°á»i má»Ÿ: chá»‰ chá»§ ca hoáº·c Admin/Quáº£n lÃ½ Ä‘Æ°á»£c káº¿t ca há»™.
      // (Bá» qua á»Ÿ cháº¿ Ä‘á»™ local-only vÃ¬ khÃ´ng cÃ³ tÃ i khoáº£n.)
      if (supa && user) {
        const isOwner = currentShift.cashier_name === cashierName;
        const canOverride = profile?.role === 'admin' || profile?.role === 'manager';
        if (!isOwner && !canOverride) {
          alert(
            `Ca nÃ y do "${currentShift.cashier_name}" má»Ÿ â€” báº¡n (${cashierName}) khÃ´ng thá»ƒ káº¿t ca há»™ Ä‘á»ƒ khá»i láº«n trÃ¡ch nhiá»‡m kÃ©t tiá»n. Nhá» Ä‘Ãºng ngÆ°á»i hoáº·c Admin/Quáº£n lÃ½ káº¿t ca.`
          );
          return false;
        }
      }
      // Invariant 4 & OFF-ERR-01 Check:
      if (!isOnline || pendingQueue.length > 0) {
        alert(
          'Lá»–I OFF-ERR-01: KhÃ´ng thá»ƒ Ä‘Ã³ng ca lÃ m viá»‡c khi thiáº¿t bá»‹ Ä‘ang Ngoáº¡i tuyáº¿n (Offline) hoáº·c cÃ²n Ä‘Æ¡n hÃ ng chá» Ä‘á»“ng bá»™!'
        );
        return false;
      }

      // P1: server hÃ³a ca â€” id UUID (tá»« RPC) thÃ¬ chá»‘t qua close_shift Ä‘á»ƒ Ä‘a mÃ¡y tháº¥y + chá»‘ng káº¿t 2 láº§n.
      // Ca local cÅ© (id 'shift-...') hoáº·c chÆ°a cáº¥u hÃ¬nh Supabase -> chá»‘t local nhÆ° trÆ°á»›c.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentShift.id);
      if (supa && user && isOnline && isUuid) {
        try {
          const { error } = await supa.rpc('close_shift', {
            p_shift_id: currentShift.id,
            p_counted_cash: countedCash,
          });
          if (error) throw new Error(error.message);
        } catch (err: any) {
          alert(`Káº¿t ca server tháº¥t báº¡i â€” giá»¯ nguyÃªn ca Ä‘á»ƒ thá»­ láº¡i: ${vietnamizeError(err)}`);
          return false;
        }
      }

      const diff = countedCash - currentShift.expected_cash;
      const closedShift: Shift = {
        ...currentShift,
        // Giá»¯ nguyÃªn cashier_name ngÆ°á»i Má»ž ca Ä‘á»ƒ truy váº¿t (khÃ´ng ghi Ä‘Ã¨ ngÆ°á»i káº¿t ca há»™)
        status: 'closed',
        closed_at: new Date().toISOString(),
        counted_cash: countedCash,
        cash_difference: diff,
      };

      setCurrentShift(closedShift);
      await db.shifts.put(closedShift);
      return true;
    },
    [isOnline, pendingQueue.length, currentShift, supa, user, cashierName, profile, setLoginOpen]
  );

  const openNewShift = useCallback(
    async (startingCash: number) => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi má»Ÿ ca!');
        setLoginOpen(true);
        return;
      }
      if (currentShift.status === 'open') {
        alert('Ca hiá»‡n táº¡i váº«n Ä‘ang má»Ÿ! HÃ£y káº¿t ca (F12) trÆ°á»›c khi má»Ÿ ca má»›i.');
        return;
      }
      if (!Number.isFinite(startingCash) || startingCash < 0) {
        alert('Tiá»n Ä‘áº§u ca khÃ´ng há»£p lá»‡!');
        return;
      }
      // P1: online + Ä‘Ã£ login -> má»Ÿ qua RPC open_shift (server cáº¥p uuid, cháº·n má»Ÿ chá»“ng ca).
      // Offline hoáº·c local-only -> má»Ÿ ca local nhÆ° trÆ°á»›c, láº§n online sau sáº½ Ä‘á»“ng bá»™ khi má»Ÿ ca má»›i.
      if (supa && user && isOnline) {
        try {
          const { data, error } = await supa.rpc('open_shift', { p_starting_cash: startingCash });
          if (error) throw new Error(error.message);
          const res = data as { id: string; cashier_name: string; starting_cash: number; expected_cash: number; opened_at: string };
          const serverShift: Shift = {
            id: res.id,
            cashier_name: res.cashier_name || cashierName,
            opened_at: res.opened_at || new Date().toISOString(),
            starting_cash: Number(res.starting_cash ?? startingCash),
            status: 'open',
            cash_sales: 0,
            transfer_sales: 0,
            deposit_collected: 0,
            cash_payouts: 0,
            expected_cash: Number(res.expected_cash ?? startingCash),
            order_count: 0,
          };
          setCurrentShift(serverShift);
          await db.shifts.add(serverShift).catch(() => db.shifts.put(serverShift));
          return;
        } catch (err: any) {
          alert(`Má»Ÿ ca server tháº¥t báº¡i â€” giá»¯ nguyÃªn Ä‘á»ƒ thá»­ láº¡i: ${vietnamizeError(err)}`);
          return;
        }
      }
      const newShift: Shift = {
        id: `shift-${Date.now()}`,
        cashier_name: cashierName,
        opened_at: new Date().toISOString(),
        starting_cash: startingCash,
        status: 'open',
        cash_sales: 0,
        transfer_sales: 0,
        deposit_collected: 0,
        cash_payouts: 0,
        expected_cash: startingCash,
        order_count: 0,
      };
      setCurrentShift(newShift);
      await db.shifts.add(newShift);
    },
    [cashierName, supa, user, currentShift, isOnline, setLoginOpen]
  );

  // P1: login/online láº¡i -> kÃ©o ca Ä‘ang má»Ÿ cá»§a mÃ¬nh tá»« server vá» (Ä‘a mÃ¡y tráº¡m Ä‘á»“ng bá»™).
  const refreshShiftFromServer = useCallback(async (): Promise<boolean> => {
    if (!supa || !user || !isOnline) return false;
    try {
      const { data, error } = await supa
        .from('shifts')
        .select('*')
        .eq('cashier_id', user.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return false;
      const row = data as any;
      const serverShift: Shift = {
        id: row.id,
        cashier_name: row.cashier_name,
        opened_at: row.opened_at,
        closed_at: row.closed_at ?? undefined,
        starting_cash: Number(row.starting_cash ?? 0),
        status: 'open',
        cash_sales: Number(row.cash_sales ?? 0),
        transfer_sales: Number(row.transfer_sales ?? 0),
        deposit_collected: Number(row.deposit_collected ?? 0),
        cash_payouts: Number(row.cash_payouts ?? 0),
        expected_cash: Number(row.expected_cash ?? 0),
        counted_cash: row.counted_cash != null ? Number(row.counted_cash) : undefined,
        cash_difference: row.cash_difference != null ? Number(row.cash_difference) : undefined,
        order_count: Number(row.order_count ?? 0),
      };
      setCurrentShift(serverShift);
      await db.shifts.put(serverShift).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }, [supa, user, isOnline]);

  // P1: vá»«a login xong hoáº·c vá»«a online láº¡i -> Ä‘á»“ng bá»™ ca Ä‘ang má»Ÿ tá»« server.
  // (cháº¡y trong microtask Ä‘á»ƒ trÃ¡nh set-state-in-effect)
  useEffect(() => {
    if (user && isOnline) Promise.resolve().then(() => refreshShiftFromServer());
  }, [user, isOnline, refreshShiftFromServer]);

  const addCashbookEntry = useCallback(
    async (entryData: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>): Promise<boolean> => {
      if (supa && !user) {
        alert('Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi láº­p phiáº¿u thu/chi!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Ca Ä‘Ã£ Ä‘Ã³ng! KhÃ´ng Ä‘Æ°á»£c láº­p phiáº¿u thu/chi sau khi káº¿t ca.');
        return false;
      }
      const code = generateOrderCode(entryData.type === 'receipt' ? 'PT' : 'PC');
      const newEntry: CashbookEntry = {
        ...entryData,
        id: `cb-${Date.now()}`,
        code,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [newEntry, ...prev]);
      await db.cashbook.add(newEntry);
      // P0: xáº¿p hÃ ng Ä‘áº©y voucher tay lÃªn server (backup/audit); online thÃ¬ Ä‘áº©y ngay
      await enqueueOp('voucher', {
        entryId: newEntry.id,
        type: newEntry.type,
        fund: newEntry.fund_type,
        category: newEntry.category,
        amount: newEntry.amount,
        partner: newEntry.partner_name || '',
        reference: newEntry.reference_order_code || '',
        note: newEntry.note || '',
      });
      void syncPendingOps();
      return true;
    },
    [supa, user, currentShift, setLoginOpen, syncPendingOps]
  );

  const importStock = useCallback(
    async (
      productId: string,
      quantity: number,
      importPrice: number,
      supplierName: string = 'NhÃ  Cung Cáº¥p',
      note: string = 'Nháº­p kho hÃ ng hÃ³a'
    ) => {
      // P2: thu ngÃ¢n/worker khÃ´ng Ä‘Æ°á»£c nháº­p kho (khi cÃ³ Supabase).
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chá»‰ Admin/Quáº£n lÃ½ Ä‘Æ°á»£c nháº­p kho!');
        return;
      }
      // P2-3: cháº·n nháº­p kho khi ca Ä‘Ã³ng (trÆ°á»›c Ä‘Ã¢y chá»‰ disable nÃºt á»Ÿ POS, gá»i trá»±c tiáº¿p váº«n lá»t).
      if (currentShift.status !== 'open') {
        alert('Ca lÃ m viá»‡c chÆ°a má»Ÿ hoáº·c Ä‘Ã£ Ä‘Ã³ng! Vui lÃ²ng má»Ÿ ca má»›i (F12) trÆ°á»›c khi nháº­p kho.');
        return;
      }
      const product = products.find((p) => p.id === productId);
      if (!product || quantity <= 0) return;

      const curStock = product.stock_quantity;
      const curAvgCost = product.avg_cost;
      const newStock = curStock + quantity;
      const newAvgCost = newStock > 0 ? Math.round((curStock * curAvgCost + quantity * importPrice) / newStock) : importPrice;

      const updatedProduct = {
        ...product,
        stock_quantity: newStock,
        avg_cost: newAvgCost,
        import_price: importPrice,
      };

      setProducts((prev) => prev.map((p) => (p.id === productId ? updatedProduct : p)));
      await db.products.update(productId, {
        stock_quantity: newStock,
        avg_cost: newAvgCost,
        import_price: importPrice,
      });

      const refCode = generateOrderCode('NH');
      const movement: StockMovement = {
        id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        reference_code: refCode,
        product_id: product.id,
        product_name: product.name,
        movement_type: 'import',
        quantity,
        previous_stock: curStock,
        new_stock: newStock,
        note: `${note} (${supplierName}) - MAC: ${curAvgCost.toLocaleString('vi-VN')}Ä‘ -> ${newAvgCost.toLocaleString('vi-VN')}Ä‘`,
        created_at: new Date().toISOString(),
      };

      setStockMovements((prev) => [movement, ...prev]);

      const expenseEntry: CashbookEntry = {
        id: `cb-${Date.now()}-import`,
        code: generateOrderCode('PC'),
        type: 'expense',
        fund_type: 'bank',
        category: 'material',
        amount: quantity * importPrice,
        partner_name: supplierName,
        reference_order_code: refCode,
        note: `Thanh toÃ¡n tiá»n nháº­p kho ${quantity} ${product.unit} ${product.name}`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      db.cashbook.add(expenseEntry).catch(console.warn);
      // P0: lÆ°u PO local + xáº¿p hÃ ng Ä‘áº©y nháº­p kho & voucher chi lÃªn server
      const poSingle: PurchaseOrder = {
        id: `po-${Date.now()}`,
        code: refCode,
        supplier_id: '',
        supplier_name: supplierName,
        items: [
          {
            product_id: product.id,
            sku: product.sku,
            name: product.name,
            quantity,
            unit_price: importPrice,
            subtotal: Math.round(quantity * importPrice),
          },
        ],
        subtotal: Math.round(quantity * importPrice),
        discount_amount: 0,
        total_amount: Math.round(quantity * importPrice),
        paid_amount: Math.round(quantity * importPrice),
        debt_amount: 0,
        status: 'completed',
        created_at: new Date().toISOString(),
      };
      db.purchaseOrders.add(poSingle).catch(console.warn);
      await enqueueOp('import', {
        clientRef: `imp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        code: refCode,
        supplierName,
        total: Math.round(quantity * importPrice),
        lines: [{ productId: product.id, sku: product.sku, quantity, importPrice }],
      });
      await enqueueOp('voucher', {
        entryId: expenseEntry.id,
        type: expenseEntry.type,
        fund: expenseEntry.fund_type,
        category: expenseEntry.category,
        amount: expenseEntry.amount,
        partner: expenseEntry.partner_name || '',
        reference: expenseEntry.reference_order_code || '',
        note: expenseEntry.note || '',
      });
      void syncPendingOps();
    },
    [products, supa, profile, currentShift, setProducts, syncPendingOps]
  );

  // Nháº­p 1 phiáº¿u nhiá»u dÃ²ng cÃ¹ng NCC: chung 1 mÃ£ NH + 1 phiáº¿u chi tá»•ng.
  // DÃ²ng trÃ¹ng 1 máº·t hÃ ng Ä‘Æ°á»£c cá»™ng dá»“n (MAC tÃ­nh ná»‘i tiáº¿p theo thá»© tá»± dÃ²ng).
  const importStockBatch = useCallback(
    async (
      lines: { productId: string; quantity: number; importPrice: number }[],
      supplierName: string = 'NhÃ  Cung Cáº¥p',
      note: string = 'Nháº­p kho hÃ ng hÃ³a'
    ): Promise<boolean> => {
      // P2: thu ngÃ¢n/worker khÃ´ng Ä‘Æ°á»£c nháº­p kho (khi cÃ³ Supabase).
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chá»‰ Admin/Quáº£n lÃ½ Ä‘Æ°á»£c nháº­p kho!');
        return false;
      }
      // P2-3: cháº·n nháº­p kho khi ca Ä‘Ã³ng (trÆ°á»›c Ä‘Ã¢y chá»‰ disable nÃºt á»Ÿ POS, gá»i trá»±c tiáº¿p váº«n lá»t).
      if (currentShift.status !== 'open') {
        alert('Ca lÃ m viá»‡c chÆ°a má»Ÿ hoáº·c Ä‘Ã£ Ä‘Ã³ng! Vui lÃ²ng má»Ÿ ca má»›i (F12) trÆ°á»›c khi nháº­p kho.');
        return false;
      }
      const clean = lines.filter((l) => {
        const p = products.find((x) => x.id === l.productId);
        return p && l.quantity > 0 && l.importPrice > 0;
      });
      if (clean.length === 0) {
        alert('Phiáº¿u nháº­p chÆ°a cÃ³ dÃ²ng hÃ ng há»£p lá»‡ (chá»n hÃ ng, SL vÃ  Ä‘Æ¡n giÃ¡ > 0)!');
        return false;
      }
      const refCode = generateOrderCode('NH');
      const now = new Date().toISOString();
      // TÃ­nh MAC ná»‘i tiáº¿p trÃªn báº£n sao (Ä‘Ãºng cáº£ khi 1 hÃ ng xuáº¥t hiá»‡n nhiá»u dÃ²ng)
      const running = new Map(products.map((p) => [p.id, { ...p }]));
      const movements: StockMovement[] = [];
      let totalAmount = 0;
      for (const l of clean) {
        const cur = running.get(l.productId);
        if (!cur) continue;
        const prevStock = cur.stock_quantity;
        const prevCost = cur.avg_cost;
        const newStock = prevStock + l.quantity;
        const newAvgCost = newStock > 0 ? Math.round((prevStock * prevCost + l.quantity * l.importPrice) / newStock) : l.importPrice;
        cur.stock_quantity = newStock;
        cur.avg_cost = newAvgCost;
        cur.import_price = l.importPrice;
        totalAmount += l.quantity * l.importPrice;
        movements.push({
          id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          reference_code: refCode,
          product_id: cur.id,
          product_name: cur.name,
          movement_type: 'import',
          quantity: l.quantity,
          previous_stock: prevStock,
          new_stock: newStock,
          note: `${note} (${supplierName}) - MAC: ${prevCost.toLocaleString('vi-VN')}Ä‘ -> ${newAvgCost.toLocaleString('vi-VN')}Ä‘`,
          created_at: now,
        });
      }
      if (movements.length === 0) return false;
      const updatedList = products.map((p) => running.get(p.id) || p);
      setProducts(updatedList);
      try {
        for (const p of running.values()) {
          const orig = products.find((x) => x.id === p.id);
          if (orig && (orig.stock_quantity !== p.stock_quantity || orig.avg_cost !== p.avg_cost)) {
            await db.products.update(p.id, {
              stock_quantity: p.stock_quantity,
              avg_cost: p.avg_cost,
              import_price: p.import_price,
            });
          }
        }
      } catch {
        /* best-effort */
      }
      setStockMovements((prev) => [...movements.reverse(), ...prev]);

      const expenseEntry: CashbookEntry = {
        id: `cb-${Date.now()}-import`,
        code: generateOrderCode('PC'),
        type: 'expense',
        fund_type: 'bank',
        category: 'material',
        amount: totalAmount,
        partner_name: supplierName,
        reference_order_code: refCode,
        note: `Thanh toÃ¡n tiá»n nháº­p kho ${movements.length} dÃ²ng hÃ ng (${supplierName})`,
        created_at: now,
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      db.cashbook.add(expenseEntry).catch(console.warn);
      // P0: lÆ°u PO local Ä‘á»ƒ trace + xáº¿p hÃ ng Ä‘áº©y nháº­p kho & voucher chi lÃªn server
      const poRecord: PurchaseOrder = {
        id: `po-${Date.now()}`,
        code: refCode,
        supplier_id: '',
        supplier_name: supplierName,
        items: clean.map((l) => {
          const p = products.find((x) => x.id === l.productId);
          return {
            product_id: l.productId,
            sku: p?.sku || '',
            name: p?.name || '',
            quantity: l.quantity,
            unit_price: l.importPrice,
            subtotal: Math.round(l.quantity * l.importPrice),
          };
        }),
        subtotal: Math.round(totalAmount),
        discount_amount: 0,
        total_amount: Math.round(totalAmount),
        paid_amount: Math.round(totalAmount),
        debt_amount: 0,
        status: 'completed',
        created_at: now,
      };
      db.purchaseOrders.add(poRecord).catch(console.warn);
      await enqueueOp('import', {
        clientRef: `imp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        code: refCode,
        supplierName,
        total: Math.round(totalAmount),
        lines: clean.map((l) => {
          const p = products.find((x) => x.id === l.productId);
          return { productId: l.productId, sku: p?.sku || '', quantity: l.quantity, importPrice: l.importPrice };
        }),
      });
      await enqueueOp('voucher', {
        entryId: expenseEntry.id,
        type: expenseEntry.type,
        fund: expenseEntry.fund_type,
        category: expenseEntry.category,
        amount: expenseEntry.amount,
        partner: expenseEntry.partner_name || '',
        reference: expenseEntry.reference_order_code || '',
        note: expenseEntry.note || '',
      });
      void syncPendingOps();
      return true;
    },
    [products, supa, profile, currentShift, setProducts, syncPendingOps]
  );

  const value: TransactionsSlice = {
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
  };
  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions(): TransactionsSlice {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions must be used within TransactionsProvider');
  return ctx;
}

