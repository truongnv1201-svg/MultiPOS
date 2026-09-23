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

// P0: nhận diện uuid server (dùng chung cho project/NCC/vật tư khi đồng bộ).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuidOrNull = (v?: string | null) => (v && UUID_RE.test(v) ? v : null);

// P0: xếp hàng đợi đẩy kho/quỹ/NCC (dedupe server bằng client_ref nên replay an toàn)
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

// P0-scale: cửa sổ + phân trang pull đơn server (trần ~1000 dòng/request của
// PostgREST; lô .in() 200 id để khỏi vỡ URL). Đơn ngoài cửa sổ vẫn tra được
// trong Dexie cache của máy.
const SERVER_ORDERS_WINDOW_DAYS = 90;
const SERVER_ORDERS_PAGE_SIZE = 1000;
const SERVER_ORDERS_MAX_PAGES = 60;
const SERVER_ITEMS_BATCH_SIZE = 200;

const EMPTY_SHIFT: Shift = {
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
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { shop, cashRounding } = useCommerce();
  const { products, setProducts, suppliers, setSuppliers, customers, setCustomers, customerMap, syncCustomers, refreshCatalog } = useCatalog();
  const { isOnline } = useNetwork();
  const [orders, setOrders] = useState<Order[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cashbook, setCashbook] = useState<CashbookEntry[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift>(EMPTY_SHIFT);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  // P0-scale: PostgREST/Supabase cắt ~1000 dòng/request khi thiếu .limit() tường
  // minh, pull full-table trong im lặng sẽ mất đơn cũ khi quán đông đơn. Kéo theo
  // cửa sổ 90 ngày + phân trang range; items gom theo lô 200 id để .in() khỏi vỡ
  // URL. Đơn cũ hơn cửa sổ vẫn còn trong Dexie cache của máy.
  const refreshServerOrders = useCallback(async (): Promise<boolean> => {
    if (!supa || !user || !isOnline) return false;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - SERVER_ORDERS_WINDOW_DAYS);
      const cutoffIso = cutoff.toISOString();
      const serverOrders: any[] = [];
      for (let from = 0, page = 0; page < SERVER_ORDERS_MAX_PAGES; from += SERVER_ORDERS_PAGE_SIZE, page++) {
        const { data, error } = await supa
          .from('orders')
          .select('*')
          .gte('created_at', cutoffIso)
          .order('created_at', { ascending: false })
          .range(from, from + SERVER_ORDERS_PAGE_SIZE - 1);
        if (error) throw error;
        serverOrders.push(...(data || []));
        if (!data || data.length < SERVER_ORDERS_PAGE_SIZE) break;
      }

      const orderIds = serverOrders.map((row: { id: string }) => row.id);
      const serverItems: any[] = [];
      for (let i = 0; i < orderIds.length; i += SERVER_ITEMS_BATCH_SIZE) {
        const batch = orderIds.slice(i, i + SERVER_ITEMS_BATCH_SIZE);
        const { data, error } = await supa.from('order_items').select('*').in('order_id', batch);
        if (error) throw error;
        serverItems.push(...(data || []));
      }

      const itemsByOrder = new Map<string, OrderItem[]>();
      for (const row of serverItems as any[]) {
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

      const mapped: Order[] = serverOrders.map((row: any) => ({
        id: `server-${row.id}`,
        server_id: row.id,
        order_code: row.order_code,
        customer_id: row.customer_id || undefined,
        customer_name: row.customer_name || 'Khách Lẻ',
        items: itemsByOrder.get(row.id) || [],
        subtotal: Number(row.subtotal || 0),
        discount_amount: Number(row.discount_amount || 0),
        discount_percent: 0,
        shipping_fee: Number(row.shipping_fee || 0),
        vat_amount: Number(row.vat_amount || 0),
        vat_percent: Number(row.vat_percent || 0),
        cash_rounding: Number(row.cash_rounding || 0),
        total_amount: Number(row.total_amount || 0),
        paid_amount: Number(row.paid_amount || 0),
        debt_amount: Number(row.debt_amount || 0),
        change_amount: Number(row.change_amount || 0),
        payments: row.paid_amount > 0 ? [{ method: 'cash', amount: Number(row.paid_amount) }] : [],
        status: row.status,
        note: row.note || undefined,
        created_at: row.created_at,
        cashier_name: row.cashier_id === user.id ? (profile?.full_name || user.email || '') : 'Nhân viên',
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
        const movementType: StockMovement['movement_type'] = /nhập|nhap|trả|tra|restock/i.test(note)
          ? 'return'
          : /công trình|project/i.test(note)
            ? 'export_project'
            : /bán|checkout|sales/i.test(note)
              ? 'export_sales'
              : 'import';
        const product = Array.isArray(row.products) ? row.products[0] : row.products;
        return {
          id: row.id,
          reference_code: row.reference_code,
          product_id: row.product_id || '',
          product_name: product?.name || 'Sản phẩm đã xóa',
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
  // P1 sổ quỹ đa máy: kéo bút toán server về hội tụ (ghi vẫn chỉ qua RPC).
  // Server thắng; giữ bản local chưa synced (nhập kho, voucher chờ đẩy, offline).
  // Dedupe legacy 1 lần: bản local cũ trùng (loại, hạng mục, tiền, tham chiếu,
  // đối tác, cùng ngày) với dòng server -> đánh dấu synced, khỏi hiện 2 lần.
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
      console.warn('Cashbook pull failed (giữ local):', err);
      return false;
    }
  }, [supa, user, isOnline]);

  // cashierName gắn với tài khoản đăng nhập (fix: trước đây hard-code 'Nguyễn Văn A'
  // nên chưa login vẫn mở/kết ca được). Chưa login -> 'Chưa đăng nhập'.

  const [pendingQueue, setPendingQueue] = useState<Order[]>([]);

  // Thu ngân hiện tại gắn với tài khoản đăng nhập (fix kết ca ẩn danh)
  const cashierName = useMemo(
    () => profile?.full_name || user?.email || 'Chưa đăng nhập',
    [profile, user]
  );

  // POS State
  const [posMode, setPosMode] = useState<'standard' | 'fast'>('fast'); // Mặc định bán nhanh
  const [posFlow, setPosFlow] = useState<'sale' | 'import'>('sale'); // Luồng POS hiện tại
  const [cartTabs, setCartTabs] = useState<CartTab[]>([DEFAULT_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  // Modals
  const [dimensionModalItem, setDimensionModalItem] = useState<{ item: OrderItem; isNew?: boolean } | null>(null);
  const [receiptModalOrder, setReceiptModalOrder] = useState<Order | null>(null);
  const [shiftModalOpen, setShiftModalOpen] = useState<boolean>(false);

  const activeCart = useMemo(() => {
    return cartTabs.find((t) => t.id === activeTabId) || cartTabs[0] || DEFAULT_TAB;
  }, [cartTabs, activeTabId]);

  // Tab operations — tab mới ăn theo mặc định POS trong Cài đặt
  const createCartTab = useCallback(() => {
    if (cartTabs.length >= 5) {
      alert('Chỉ được mở tối đa 5 hóa đơn cùng lúc! Hãy thanh toán hoặc đóng bớt tab.');
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
      price_book: 'retail',
    };
    setCartTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, [cartTabs.length, shop.defaultVat, shop.defaultPayment]);

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
        const itemPrice = priceOverride !== undefined ? priceOverride : product.retail_price;

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
    (_priceBook?: 'retail' | 'trade') => {
      // Bảng giá bán duy nhất: luôn áp dụng đơn giá niêm yết (product.retail_price)
      updateActiveTab((tab) => {
        const updatedItems = tab.items.map((item) => {
          const product = products.find((p) => p.id === item.product_id);
          if (!product) return item;
          return recomputeOrderItem({
            ...item,
            unit_price: product.retail_price,
          });
        });
        return {
          ...tab,
          price_book: 'retail',
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
  // Tổng giỏ dùng chung lib/pricing (single source, có unit test) — khớp server từng đồng.
  const calculatedTotals = useMemo(() => calcCartTotals(activeCart, cashRounding), [activeCart, cashRounding]);

  // Checkout Transaction Logic (SRS §2.2 & Invariants 1-5)
  // P3: online + Supabase -> commit nguyên tử qua RPC pos_checkout (server tính lại
  // tiền/kho/nợ/sổ quỹ). Offline hoặc chưa cấu hình -> logic local + hàng đợi pending.
  const checkoutActiveOrder = useCallback(
    async (isDeposit = false): Promise<Order | null> => {
      if (activeCart.items.length === 0) return null;
      // Fix thu ngân: bắt buộc đăng nhập (khi có Supabase) + ca đang mở mới được bán.
      if (supa && !user) {
        alert('Vui lòng đăng nhập thu ngân trước khi thanh toán!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới (F12) trước khi bán hàng.');
        setShiftModalOpen(true);
        return null;
      }
      // Ca đang mở phải đứng tên người bán (trừ Admin/Quản lý) — khỏi dồn doanh số vào ca người khác
      if (
        supa &&
        user &&
        currentShift.cashier_name !== cashierName &&
        profile?.role !== 'admin' &&
        profile?.role !== 'manager'
      ) {
        alert(
          `Ca đang mở đứng tên "${currentShift.cashier_name}", không phải bạn (${cashierName}). Hãy kết ca cũ (F12) / nhờ Admin rồi mở ca mới trước khi bán.`
        );
        setShiftModalOpen(true);
        return null;
      }

      const totals = calculatedTotals;
      let orderCode = generateOrderCode('HD');
      // P0-idempotency: khóa ổn định cho 1 lần bán — gửi lên server để retry/timeout
      // mập mờ không sinh trùng đơn; đơn offline dùng luôn id này khi replay.
      const clientRef = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      // Ô trống = trả đủ CHỈ cho chuyển khoản/quẹt thẻ; tiền mặt bắt buộc đã nhập (UI chặn),
      // nợ ghi 0 để rơi vào guard nợ vô chủ (chung lib/pricing với POSScreen)
      let paidAmount = resolvePaidAmount(totals.payable, activeCart.payment_method, activeCart.tendered_amount || 0);
      let actualDebt = totals.payable - paidAmount;
      // Số liệu hiệu dụng: mặc định = tính local, server ghi đè khi commit RPC thành công
      let effSubtotal = totals.subtotal;
      let effDiscount = totals.discount_amount;
      let effVat = totals.vat_amount;
      let effRounding = totals.cash_rounding;
      let effPayable = totals.payable;
      let effChange = totals.change_amount;
      let serverOrderId: string | null = null;
      // P1 sổ quỹ đa máy: RPC thành công là server đã ghi receipt -> mirror local
      // đánh dấu synced để lần pull sau không trùng dòng.
      let serverCommitted = false;

      if (isOnline && supa) {
        try {
          // 0009: nợ > 0 mà KH chưa map uuid server -> sync gấp trước khi commit
          // (server guard sẽ rollback nếu nợ vô chủ)
          let serverCustId: string | null =
            activeCart.customer_id ? customerMap[activeCart.customer_id] ?? null : null;
          if (actualDebt > 0 && activeCart.customer_id && !serverCustId) {
            const fresh = await syncCustomers();
            serverCustId = fresh[activeCart.customer_id] ?? null;
          }
          // Gửi TIỀN KHÁCH ĐƯA (không kẹp ở payable) để server chia paid/change/debt làm
          // chuẩn — trước đây kẹp paid ở payable nên hóa đơn online không bao giờ hiện tiền
          // thừa (bug lộ bởi fuzz parity). Ô trống = trả đủ cho chuyển khoản/quẹt thẻ
          // (khớp resolvePaidAmount); cash trống đã bị UI chặn từ POSScreen.
          let tendered = activeCart.tendered_amount || 0;
          if (activeCart.payment_method !== 'cash' && activeCart.payment_method !== 'debt' && tendered <= 0) {
            tendered = totals.payable;
          }
          const rpcPayments =
            activeCart.payment_method === 'debt' || tendered <= 0
              ? []
              : [{ method: activeCart.payment_method, amount: tendered }];
          // 0023: server tính VAT riêng qua p_vat_percent (khớp calculatedTotals từng đồng).
          // Server chưa migrate (không có overload 9-arg) -> PostgREST PGRST202 -> fallback
          // cách cũ: gộp VAT vào ship để total vẫn khớp.
          const rpcBase = {
            p_customer_name: activeCart.customer_name || 'Khách Lẻ Mua Tại Quầy',
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
          // 0024: giữ UUID server để cancel/return gọi đúng đơn (khỏi lookup)
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
          alert(`Lỗi commit server — giữ nguyên giỏ để thử lại: ${vietnamizeError(err)}`);
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
        customer_name: activeCart.customer_name || 'Khách Lẻ Mua Tại Quầy',
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

        // Regular item hoặc area: area tính theo m2 thực x waste hiện tại (mirror server 0028),
        // không tin material_consumed cũ trong giỏ
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

      // P0-3: chặn bán lố kho ngay cả offline (server sẽ RAISE + rollback,
      // đơn offline replay fail sẽ kẹt queue câm). Kiểm tra trước khi trừ.
      const insufficient: string[] = [];
      for (const [pid, need] of Object.entries(stockDeductions)) {
        const p = products.find((x) => x.id === pid);
        if (p && p.stock_quantity < need) insufficient.push(`${p.sku} (tồn ${p.stock_quantity}, cần ${need})`);
        // Combo con thiếu cũng đã gộp trong stockDeductions qua child.product_id nên check chung.
      }
      // Kiểm tra linh kiện combo con thiếu theo tên để báo rõ
      if (insufficient.length > 0) {
        alert(`Tồn kho không đủ, không thể bán:\n${insufficient.join('\n')}\nHãy giảm SL hoặc nhập kho thêm.`);
        return null;
      }

      // Update in-memory and DB stock (không kẹp max(0) để khỏi lệch truth với server)
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
            ? `Thu cọc đơn hàng ${orderCode}`
            : `Thanh toán hóa đơn ${orderCode} (${activeCart.payment_method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản VietQR'})`,
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

      // Thông báo thành công (kể cả khi tắt In tự động nên không mở phiếu)
      const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đ`;
      notify(
        isDeposit
          ? `Thu cọc thành công ${orderCode}\nĐã nhận: ${vnd(paidAmount)}`
          : actualDebt > 0
            ? `Thanh toán thành công ${orderCode}\nĐã thu: ${vnd(paidAmount)} • Còn nợ: ${vnd(actualDebt)}`
            : effChange > 0
              ? `Thanh toán thành công ${orderCode}\nĐã thu: ${vnd(paidAmount)} • Thối lại: ${vnd(effChange)}`
              : `Thanh toán thành công ${orderCode}\nĐã thu: ${vnd(paidAmount)}`,
        'success',
      );

      // In tự động (Cài đặt → Trung tâm in ấn): BẬT = tự mở phiếu sau bán để bấm In;
      // TẮT = về bán tiếp luôn, xem/in lại trong Đơn hàng. Mặc định BẬT (!== false
      // để máy cũ chưa có key này vẫn giữ hành vi cũ).
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
  // P3: có Supabase -> replay từng đơn offline lên server qua pos_checkout rồi mới
  // xóa hàng đợi (đơn replay nhận mã HD mới của server; mã offline cũ giữ ở máy trạm).
  // Chưa cấu hình server -> hành vi cũ (đánh dấu đã sync).
  const syncPendingOrders = useCallback(async () => {
    if (!isOnline || pendingQueue.length === 0) return;
    if (supa) {
      const syncedIds: string[] = [];
      const remaining: Order[] = [];
      const failures: string[] = [];
      for (const o of pendingQueue) {
        try {
          // Đơn offline mới (có vat_percent) -> gửi VAT riêng cho server 0023.
          // Đơn offline cũ (không có vat_*, VAT nằm lẫn trong total) -> khôi phục residual
          // = total - (subtotal - discount + ship - rounding) rồi gộp vào ship (tương thích
          // cả server cũ lẫn mới).
          const oVatPct = o.vat_percent || 0;
          const vatResidual = Math.max(
            0,
            (o.total_amount || 0) -
              ((o.subtotal || 0) - (o.discount_amount || 0) + (o.shipping_fee || 0) - (o.cash_rounding || 0))
          );
          // Replay gửi TIỀN KHÁCH ĐƯA (như checkout online) để server chia paid/change/debt.
          // Đơn mới có tendered_amount; đơn cũ fallback paid đã kẹp trong payments.
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
            // P0-idempotency: key ổn định = id đơn local -> retry không sinh trùng đơn
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
          // Lưu server_id để Hủy/Trả gọi đúng đơn (khỏi lookup theo mã offline cũ)
          const replayOrderId = (replayData as { order_id?: unknown } | null)?.order_id;
          if (typeof replayOrderId === 'string' && replayOrderId) {
            setOrders((prev) =>
              prev.map((ord) =>
                ord.id === o.id
                  ? { ...ord, server_id: replayOrderId, is_offline: false, sync_attempts: 0, sync_last_error: undefined }
                  : ord
              )
            );
            await db.orders
              .update(o.id, { server_id: replayOrderId, is_offline: false, sync_attempts: 0, sync_last_error: undefined })
              .catch(() => {});
          }
          // P1 sổ quỹ: replay đã ghi receipt server -> mirror local theo mã đơn offline
          // đánh dấu synced để pull sau không trùng dòng.
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
          // P0-3: giữ lại + ghi lý do để khỏi kẹt queue câm (nợ vô chủ / hết kho / mất mạng)
          const syncAttempts = (o.sync_attempts || 0) + 1;
          const syncLastError = e?.message || 'lỗi replay';
          const failedOrder = { ...o, sync_attempts: syncAttempts, sync_last_error: syncLastError };
          remaining.push(failedOrder); // giữ lại để thử đợt sau
          failures.push(`${o.order_code}: ${syncLastError}`);
          await db.pendingOrders.put(failedOrder).catch(() => {});
          setOrders((prev) => prev.map((ord) => (ord.id === o.id ? failedOrder : ord)));
        }
      }
      setPendingQueue(remaining);
      if (failures.length > 0) {
        alert(`Đồng bộ ${failures.length} đơn offline thất bại, giữ lại để thử sau:\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? `\n...và ${failures.length - 5} đơn nữa` : ''}`);
      }
      if (syncedIds.length > 0) {
        setOrders((prev) =>
          prev.map((ord) => (syncedIds.includes(ord.id) ? { ...ord, is_offline: false } : ord))
        );
        refreshCatalog(); // kéo tồn kho server về sau replay
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

  // Tra UUID server của đơn (0024): ưu tiên server_id đã lưu khi checkout, fallback tra
  // theo order_code (authenticated được SELECT orders — RLS 0006). Đơn chưa lên server -> null.
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
        /* tra cứu thất bại -> coi như chưa link server */
      }
      return null;
    },
    [supa, user, isOnline]
  );

  // Cancel Order & Reverse (FIN-ERR-05)
  // 0024: đơn đã lên server + online -> commit qua RPC cancel_order (server hoàn kho/đảo nợ/
  // hoàn quỹ; local mirror lại cho Dexie/UI khớp). Đơn server mà offline -> CHẶN để khỏi lệch
  // truth. Đơn chưa lên server -> xử lý local + gỡ khỏi hàng đợi pending.
  const cancelOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi hủy đơn!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Không được hủy/trả đơn sau khi kết ca.');
        return false;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.status === 'cancelled' || order.status === 'returned') return false;

      const serverId = await resolveServerOrderId(order);
      if (serverId && !isOnline) {
        alert('Đơn này đã đồng bộ server nhưng đang ngoại tuyến — không thể hủy lúc này để tránh lệch kho/nợ. Hãy online rồi thử lại.');
        return false;
      }
      if (serverId && supa) {
        try {
          const { error } = await supa.rpc('cancel_order', { p_order_id: serverId });
          if (error) throw new Error(error.message);
        } catch (err: any) {
          alert(`Hủy đơn server thất bại — giữ nguyên đơn để thử lại: ${vietnamizeError(err)}`);
          return false;
        }
      }

      // 1. Restore stock (mirror server 0024+0028: hàng area theo m2 thực x waste server,
      // hàng thường theo quantity, combo con theo BOM — không tin material_consumed client cũ)
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
      // P1 sổ quỹ: RPC cancel_order đã ghi đảo server -> mirror đánh dấu synced.
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
            note: `Hoàn tiền hủy đơn hàng ${order.order_code} qua quỹ ${pmt.method === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}`,
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
      // Đơn offline chưa lên server: gỡ khỏi hàng đợi để khỏi replay đơn đã hủy
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
        alert('Vui lòng đăng nhập trước khi trả hàng!');
        setLoginOpen(true);
        return fail;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Không được hủy/trả đơn sau khi kết ca.');
        return fail;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order) return fail;
      // 0026: chỉ đơn hiệu lực mới trả được (chặn trả lặp cả khi gọi trực tiếp hàm)
      if (order.status !== 'completed' && order.status !== 'deposit_order') {
        alert('Đơn này đã hủy/trả rồi — không xử lý lặp.');
        return fail;
      }

      const totalRefundAmount = refundItems.reduce((sum, r) => sum + r.amount, 0);
      if (totalRefundAmount <= 0) return fail;

      // 0025: dựng danh sách hoàn kho từ dòng trả — goods hoàn đủ SL, combo rã BOM con,
      // area/service KHÔNG hoàn (hàng đã cắt/tiêu hao). Server cap theo SL đã bán + từ chối
      // area/service kể cả khi bị gửi nhầm.
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
          clientSkipped.push({ sku: line.sku, reason: line.product_type === 'area' ? 'hàng cắt theo kích thước, không nhập lại' : 'dịch vụ, không nhập kho' });
        }
      }
      const pRestock = [...restockReq.entries()].map(([sku, quantity]) => ({ sku, quantity }));

      // 0024: đơn đã lên server + online -> RPC return_order_items (server trừ nợ/hoàn tiền/
      // hoàn kho, local mirror theo đúng số server trả về). Đơn server mà offline -> CHẶN.
      const serverId = await resolveServerOrderId(order);
      if (serverId && !isOnline) {
        alert('Đơn này đã đồng bộ server nhưng đang ngoại tuyến — không thể trả hàng lúc này để tránh lệch nợ. Hãy online rồi thử lại.');
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
              .map((e: any) => ({ sku: e.sku as string, reason: String(e.reason || 'server từ chối') }));
          }
        } catch (err: any) {
          alert(`Trả hàng server thất bại — giữ nguyên đơn để thử lại: ${vietnamizeError(err)}`);
          return fail;
        }
      }

      // Customer debt reduction with clamping (FIN-ERR-03) — mirror server khi có
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

      // Hoàn kho mirror (0025): online thì theo đúng restocked server đã cap, offline/local
      // thì theo yêu cầu đã dựng (tin caller, UI hiện chỉ trả full đơn).
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
          ? ` + nhập lại kho: ${finalRestocked.map((l) => `${l.sku} x${l.quantity}`).join(', ')}`
          : '';

      // Expense entry for cash refund surplus
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
          note: `Hoàn tiền trả hàng cho đơn ${order.order_code} (sau khi đã khấu trừ nợ)${restockNote}`,
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
      // Đơn offline chưa lên server: gỡ khỏi hàng đợi để khỏi replay đơn đã trả
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
        alert('Vui lòng đăng nhập trước khi thu nợ!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Không được thu nợ sau khi kết ca. Vui lòng mở ca mới (F12).');
        return false;
      }
      const customer = customers.find((c) => c.id === customerId);
      if (!customer || amount <= 0) return false;

      // 0024: KH đã link server + online -> RPC collect_debt (server clamp theo nợ thật,
      // local mirror theo số server trả về + refresh truth). KH server mà offline -> CHẶN.
      const serverCustId = customerMap[customerId] ?? null;
      if (serverCustId && !isOnline) {
        alert('Khách hàng đã đồng bộ server nhưng đang ngoại tuyến — không thể thu nợ lúc này để tránh lệch công nợ. Hãy online rồi thử lại.');
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
          alert(`Thu nợ server thất bại — giữ nguyên để thử lại: ${vietnamizeError(err)}`);
          return false;
        }
      }

      const actualCollect = serverCollected ?? Math.min(amount, customer.current_debt);
      if (actualCollect <= 0) {
        alert('Không còn nợ phải thu (server báo KH đã hết nợ).');
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
        note: note || `Thu nợ khách hàng ${customer.name} qua ${paymentMethod === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}`,
        created_at: new Date().toISOString(),
        // P1 sổ quỹ: RPC collect_debt đã ghi thu server -> mirror đánh dấu synced
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

      // Refresh nợ thật từ server (local có thể lệch truth) — best-effort
      if (serverCustId && supa && isOnline) {
        try {
          const { data } = await supa.from('customers').select('current_debt').eq('id', serverCustId).maybeSingle();
          const truth = Number((data as { current_debt?: unknown } | null)?.current_debt);
          if (Number.isFinite(truth)) {
            setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, current_debt: truth } : c)));
            await db.customers.update(customerId, { current_debt: truth });
          }
        } catch {
          /* giữ số mirror */
        }
      }

      return true;
    },
    [customers, customerMap, isOnline, supa, user, currentShift, setLoginOpen, setCustomers]
  );

  // Đồng bộ nợ KH từ server (0025+1): server là truth công nợ — số local có thể cũ khi thu nợ
  // ở máy khác, sửa tay trên Dashboard, hoặc sync gián đoạn. Kéo batch theo uuid đã map,
  // ghi đè current_debt (+debt_limit) local + Dexie. KH chưa link (khách lẻ, máy khác tạo)
  // được bỏ qua — đếm vào skipped để UI báo rõ.
  const syncDebtsFromServer = useCallback(async (): Promise<{ updated: number; skipped: number }> => {
    if (!supa || !user) {
      alert('Vui lòng đăng nhập trước khi đồng bộ công nợ!');
      setLoginOpen(true);
      return { updated: 0, skipped: 0 };
    }
    if (!isOnline) {
      alert('Đang ngoại tuyến — không thể đồng bộ công nợ. Hãy online rồi thử lại.');
      return { updated: 0, skipped: 0 };
    }
    const linked = customers.filter((c) => c.id !== 'cust-1' && customerMap[c.id]);
    const skipped = customers.length - linked.length;
    if (linked.length === 0) return { updated: 0, skipped };
    try {
      // Đảo map uuid server -> id local
      const byUuid = new Map<string, string>();
      for (const c of linked) byUuid.set(customerMap[c.id], c.id);
      const truth = new Map<string, { debt: number; limit: number }>();
      // Chia lô 100 uuid để URL REST không quá dài
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
      alert(`Đồng bộ công nợ thất bại: ${vietnamizeError(err)}`);
      return { updated: 0, skipped };
    }
  }, [supa, user, isOnline, customers, customerMap, setLoginOpen, setCustomers]);

  // P0: quét hàng đợi kho/quỹ/NCC — FIFO khi online. Server dedupe bằng client_ref
  // nên replay an toàn; supplier_payment còn kéo truth nợ về mirror như thu nợ KH.
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
            supplierId?: string;
            supplierName: string;
            total: number;
            paid?: number;
            debt?: number;
            lines: { productId: string; sku: string; quantity: number; importPrice: number }[];
          };
          const supUuid = p.supplierId && /^[0-9a-fA-F-]{36}$/.test(p.supplierId) ? p.supplierId : null;
          const { error } = await supa.rpc('sync_stock_import', {
            p_client_ref: p.clientRef,
            p_code: p.code,
            p_supplier_id: supUuid,
            p_supplier_name: p.supplierName,
            p_lines: p.lines.map((l) => ({
              sku: l.sku,
              product_id: asUuidOrNull(l.productId),
              quantity: l.quantity,
              import_price: l.importPrice,
            })),
            p_total: p.total,
            p_paid: p.paid ?? p.total,
            p_debt: p.debt ?? 0,
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
          if (!serverSid) continue; // NCC chưa đồng bộ master -> giữ hàng đợi
          const { data, error } = await supa.rpc('pay_supplier_debt', {
            p_client_ref: p.entryId,
            p_supplier_id: serverSid,
            p_amount: p.amount,
            p_method: p.method,
            p_note: p.note || null,
          });
          if (error) throw error;
          // Mirror truth nợ NCC từ server (server clamp theo nợ thật)
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
            /* giữ số mirror */
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

  // Master Data Add/Update hàng hóa/KH/NCC sống ở CatalogProvider (useCatalog) —
  // ở đây chỉ còn nghiệp vụ chi trả NCC (đụng sổ quỹ -> thuộc tầng Transactions).
  const paySupplierDebt = useCallback(
    async (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string): Promise<boolean> => {
      // P2: thu ngân/worker không được chi trả NCC
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chỉ Admin/Quản lý được chi trả nợ NCC!');
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
        note: `Chi trả nợ NCC ${supplier.name}: ${note}`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      await db.cashbook.add(expenseEntry);
      // P0: xếp hàng đẩy trả NCC lên server (clamp + truth ở sweep); online thì đẩy ngay
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

  // Tính lại tổng công trình từ dòng (mirror công thức P&L ở ProjectsView)
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

  // ---- Đồng bộ Dự án/Công trình 2 chiều (migration 0040) ----
  // Local-first: id `proj-...` = chưa đẩy; sau khi đẩy gắn server_id, giữ id local
  // ổn định cho UI. Server thắng khi kéo, trừ bản local chưa từng đẩy.

  // Đẩy 1 công trình: header upsert trực tiếp + dòng vật tư/thợ qua RPC
  // sync_project_workspace (delta tồn kho, chạy lại không trừ 2 lần).
  // Giữ id local ổn định cho UI, chỉ gắn server_id (mirror customerMap).
  // Lỗi mạng/quyền -> warn + giữ local, trả null.
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
            // Mã CT đã tồn tại (đẩy từ máy khác) -> dùng bản server rồi update
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
        // Gắn server_id vào bản local (giữ nguyên id cho UI đang cầm)
        if (project.server_id !== serverId) {
          await db.projects.update(project.id, { server_id: serverId as string }).catch(() => {});
          setProjects((prev) =>
            prev.map((p) => (p.id === project.id ? { ...p, server_id: serverId as string } : p))
          );
          return { ...project, server_id: serverId as string };
        }
        return project;
      } catch (err) {
        console.warn('Project push failed (giữ local):', err);
        return null;
      }
    },
    [supa, user, isOnline, customerMap]
  );

  // Kéo công trình từ server (server thắng), giữ bản local chưa từng đẩy.
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
            name: typeof r.name === 'string' && r.name ? r.name : 'Vật tư',
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
            role: typeof r.role === 'string' && r.role ? r.role : 'Thợ',
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
      console.warn('Project pull failed (giữ local):', err);
      return false;
    }
  }, [supa, user, customerMap]);

  // Đồng bộ đầy đủ khi online: kéo trước, đẩy nốt bản local chưa lên.
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
      // Đẩy lên server để remap id local -> uuid (thất bại vẫn giữ local)
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

  // Phase 2: xuất vật tư cho công trình — trừ tồn kho thật + thẻ kho export_project.
  // Chỉ hàng goods/area (service/combo chặn); đơn giá vốn = avg_cost hiện tại.
  const exportProjectMaterial = useCallback(
    async (projectId: string, productId: string, quantity: number): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi xuất vật tư!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Mở ca mới (F12) trước khi xuất vật tư cho công trình.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      const product = products.find((x) => x.id === productId);
      if (!product) return null;
      if (product.product_type === 'service' || product.product_type === 'combo') {
        alert('Hàng dịch vụ/combo không xuất trực tiếp cho công trình! Chọn hàng hóa hoặc hàng diện tích.');
        return null;
      }
      if (!(quantity > 0)) {
        alert('Số lượng xuất phải lớn hơn 0!');
        return null;
      }
      if (product.stock_quantity < quantity) {
        alert(`Tồn kho không đủ: ${product.sku} (tồn ${product.stock_quantity} ${product.unit}, cần ${quantity}).`);
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
        note: `Xuất cho công trình ${project.code} (${project.name})`,
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

  // Phase 2 (batch): xuất 1 phiếu nhiều dòng — validate hết trước, 1 lần trừ kho + 1 lần chốt đơn
  const exportProjectMaterialBatch = useCallback(
    async (projectId: string, lines: { productId: string; quantity: number }[]): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi xuất vật tư!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Mở ca mới (F12) trước khi xuất vật tư cho công trình.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      // Gộp dòng trùng + validate toàn phiếu trước khi trừ (1 dòng lỗi -> hủy cả phiếu)
      const merged = new Map<string, number>();
      for (const l of lines) merged.set(l.productId, (merged.get(l.productId) || 0) + (l.quantity || 0));
      const errors: string[] = [];
      const items: { product: Product; quantity: number }[] = [];
      for (const [pid, qty] of merged) {
        const product = products.find((x) => x.id === pid);
        if (!product) {
          errors.push('Mặt hàng không tồn tại trong kho.');
          continue;
        }
        if (product.product_type === 'service' || product.product_type === 'combo') {
          errors.push(`${product.sku}: dịch vụ/combo không xuất trực tiếp.`);
          continue;
        }
        if (!(qty > 0)) {
          errors.push(`${product.sku}: số lượng phải lớn hơn 0.`);
          continue;
        }
        if (product.stock_quantity < qty) {
          errors.push(`${product.sku}: tồn ${product.stock_quantity} ${product.unit}, cần ${qty}.`);
          continue;
        }
        items.push({ product, quantity: qty });
      }
      if (items.length === 0) {
        alert('Phiếu xuất chưa có dòng hợp lệ!' + (errors.length > 0 ? `\n${errors.join('\n')}` : ''));
        return null;
      }
      if (errors.length > 0) {
        alert(`Phiếu có dòng lỗi, chưa xuất:\n${errors.join('\n')}`);
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
          note: `Xuất cho công trình ${project.code} (${project.name})`,
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

  // Phase 3: đưa chi phí nhân công vào công trình (thợ lấy từ hồ sơ nhân sự, link employee_id)
  const addProjectWorker = useCallback(
    async (
      projectId: string,
      worker: { worker_name: string; role: string; days_worked: number; daily_wage: number; allowance: number; employee_id?: string; employee_code?: string }
    ): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi thêm thợ!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (!worker.worker_name.trim()) {
        alert('Vui lòng nhập tên thợ!');
        return null;
      }
      if (!(worker.days_worked > 0)) {
        alert('Số ngày công phải lớn hơn 0!');
        return null;
      }
      const line: ProjectWorker = {
        id: `pw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        employee_id: worker.employee_id || undefined,
        employee_code: worker.employee_code || undefined,
        worker_name: worker.worker_name.trim(),
        role: worker.role.trim() || 'Thợ',
        days_worked: worker.days_worked,
        daily_wage: Math.max(0, Math.round(worker.daily_wage)),
        allowance: Math.max(0, Math.round(worker.allowance)),
        total_wage: 0,
      };
      line.total_wage = Math.round(line.days_worked * line.daily_wage + line.allowance);
      // Trùng thợ (cùng mã NV, hoặc thợ ngoài cùng tên+việc+lương) -> cộng dồn ngày công
      // vào dòng cũ thay vì tách dòng mới
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

  // Sửa số tài chính (dự toán/quyết toán/chi khác độc lập nhau) + tính lại lãi
  const updateProjectFinance = useCallback(
    async (
      projectId: string,
      finance: { estimated_revenue?: number; settled_revenue?: number; other_costs?: number }
    ): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi sửa công trình!');
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

  // Thu cọc/tạm ứng chủ đầu tư: phiếu thu deposit theo mã CT + cộng dồn deposit_amount.
  // (Cọc không trừ vào lãi — lãi = quyết toán − tổng chi; còn phải thu = quyết toán − đã cọc.)
  const collectProjectDeposit = useCallback(
    async (projectId: string, amount: number, paymentMethod: 'cash' | 'transfer'): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi thu cọc!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Mở ca mới (F12) trước khi thu cọc công trình.');
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
        note: `Thu cọc công trình ${project.code} (${project.name})`,
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
        alert('Vui lòng đăng nhập trước khi sửa công trình!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (kind === 'material') {
        if (currentShift.status !== 'open') {
          alert('Ca đã đóng! Mở ca mới (F12) trước khi hoàn vật tư về kho.');
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
            note: `Hoàn vật tư từ công trình ${project.code} (${project.name})`,
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
      // Fix thu ngân: bắt buộc đăng nhập + ca đang mở mới được kết ca.
      if (supa && !user) {
        alert('Vui lòng đăng nhập thu ngân trước khi kết ca!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Không có ca đang mở! Ca này đã được kết trước đó.');
        return false;
      }
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        alert('Số tiền kiểm đếm không hợp lệ!');
        return false;
      }
      // Gắn ca với người mở: chỉ chủ ca hoặc Admin/Quản lý được kết ca hộ.
      // (Bỏ qua ở chế độ local-only vì không có tài khoản.)
      if (supa && user) {
        const isOwner = currentShift.cashier_name === cashierName;
        const canOverride = profile?.role === 'admin' || profile?.role === 'manager';
        if (!isOwner && !canOverride) {
          alert(
            `Ca này do "${currentShift.cashier_name}" mở — bạn (${cashierName}) không thể kết ca hộ để khỏi lẫn trách nhiệm két tiền. Nhờ đúng người hoặc Admin/Quản lý kết ca.`
          );
          return false;
        }
      }
      // Invariant 4 & OFF-ERR-01 Check:
      if (!isOnline || pendingQueue.length > 0) {
        alert(
          'LỖI OFF-ERR-01: Không thể đóng ca làm việc khi thiết bị đang Ngoại tuyến (Offline) hoặc còn đơn hàng chờ đồng bộ!'
        );
        return false;
      }

      // P1: server hóa ca — id UUID (từ RPC) thì chốt qua close_shift để đa máy thấy + chống kết 2 lần.
      // Ca local cũ (id 'shift-...') hoặc chưa cấu hình Supabase -> chốt local như trước.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentShift.id);
      if (supa && user && isOnline && isUuid) {
        try {
          const { error } = await supa.rpc('close_shift', {
            p_shift_id: currentShift.id,
            p_counted_cash: countedCash,
          });
          if (error) throw new Error(error.message);
        } catch (err: any) {
          alert(`Kết ca server thất bại — giữ nguyên ca để thử lại: ${vietnamizeError(err)}`);
          return false;
        }
      }

      const diff = countedCash - currentShift.expected_cash;
      const closedShift: Shift = {
        ...currentShift,
        // Giữ nguyên cashier_name người MỞ ca để truy vết (không ghi đè người kết ca hộ)
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
        alert('Vui lòng đăng nhập trước khi mở ca!');
        setLoginOpen(true);
        return;
      }
      if (currentShift.status === 'open') {
        alert('Ca hiện tại vẫn đang mở! Hãy kết ca (F12) trước khi mở ca mới.');
        return;
      }
      if (!Number.isFinite(startingCash) || startingCash < 0) {
        alert('Tiền đầu ca không hợp lệ!');
        return;
      }
      // P1: online + đã login -> mở qua RPC open_shift (server cấp uuid, chặn mở chồng ca).
      // Offline hoặc local-only -> mở ca local như trước, lần online sau sẽ đồng bộ khi mở ca mới.
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
          alert(`Mở ca server thất bại — giữ nguyên để thử lại: ${vietnamizeError(err)}`);
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

  // P1: login/online lại -> kéo ca đang mở của mình từ server về (đa máy trạm đồng bộ).
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

  // P1: vừa login xong hoặc vừa online lại -> đồng bộ ca đang mở từ server.
  // (chạy trong microtask để tránh set-state-in-effect)
  useEffect(() => {
    if (user && isOnline) Promise.resolve().then(() => refreshShiftFromServer());
  }, [user, isOnline, refreshShiftFromServer]);

  const addCashbookEntry = useCallback(
    async (entryData: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>): Promise<boolean> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi lập phiếu thu/chi!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Không được lập phiếu thu/chi sau khi kết ca.');
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
      // P0: xếp hàng đẩy voucher tay lên server (backup/audit); online thì đẩy ngay
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
      supplierName: string = 'Nhà Cung Cấp',
      note: string = 'Nhập kho hàng hóa'
    ) => {
      // P2: thu ngân/worker không được nhập kho (khi có Supabase).
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chỉ Admin/Quản lý được nhập kho!');
        return;
      }
      // P2-3: chặn nhập kho khi ca đóng (trước đây chỉ disable nút ở POS, gọi trực tiếp vẫn lọt).
      if (currentShift.status !== 'open') {
        alert('Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới (F12) trước khi nhập kho.');
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
        note: `${note} (${supplierName}) - MAC: ${curAvgCost.toLocaleString('vi-VN')}đ -> ${newAvgCost.toLocaleString('vi-VN')}đ`,
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
        note: `Thanh toán tiền nhập kho ${quantity} ${product.unit} ${product.name}`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      db.cashbook.add(expenseEntry).catch(console.warn);
      // P0: lưu PO local + xếp hàng đẩy nhập kho & voucher chi lên server
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

  // Nhập 1 phiếu nhiều dòng cùng NCC: chung 1 mã NH + 1 phiếu chi tổng.
  // Dòng trùng 1 mặt hàng được cộng dồn (MAC tính nối tiếp theo thứ tự dòng).
  const importStockBatch = useCallback(
    async (
      lines: { productId: string; quantity: number; importPrice: number }[],
      supplierName: string = 'Nhà Cung Cấp',
      note: string = 'Nhập kho hàng hóa',
      paymentOptions?: {
        paymentMethod?: 'cash' | 'transfer' | 'debt' | 'partial';
        paidAmount?: number;
        supplierId?: string;
      }
    ): Promise<boolean> => {
      // P2: thu ngân/worker không được nhập kho (khi có Supabase).
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chỉ Admin/Quản lý được nhập kho!');
        return false;
      }
      // P2-3: chặn nhập kho khi ca đóng (trước đây chỉ disable nút ở POS, gọi trực tiếp vẫn lọt).
      if (currentShift.status !== 'open') {
        alert('Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới (F12) trước khi nhập kho.');
        return false;
      }
      const clean = lines.filter((l) => {
        const p = products.find((x) => x.id === l.productId);
        return p && l.quantity > 0 && l.importPrice > 0;
      });
      if (clean.length === 0) {
        alert('Phiếu nhập chưa có dòng hàng hợp lệ (chọn hàng, SL và đơn giá > 0)!');
        return false;
      }
      const refCode = generateOrderCode('NH');
      const now = new Date().toISOString();

      const paymentMethod = paymentOptions?.paymentMethod || 'transfer';
      const supplierId = paymentOptions?.supplierId || '';

      // Tính MAC nối tiếp trên bản sao (đúng cả khi 1 hàng xuất hiện nhiều dòng)
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
          note: `${note} (${supplierName}) - MAC: ${prevCost.toLocaleString('vi-VN')}đ -> ${newAvgCost.toLocaleString('vi-VN')}đ`,
          created_at: now,
        });
      }
      if (movements.length === 0) return false;

      let paidAmount = 0;
      if (paymentMethod === 'cash' || paymentMethod === 'transfer') {
        paidAmount = Math.round(totalAmount);
      } else if (paymentMethod === 'debt') {
        paidAmount = 0;
      } else if (paymentMethod === 'partial') {
        paidAmount = Math.max(0, Math.min(Math.round(totalAmount), Math.round(paymentOptions?.paidAmount || 0)));
      }
      const debtAmount = Math.max(0, Math.round(totalAmount) - paidAmount);

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

      // 1) Nếu paidAmount > 0: tạo phiếu chi Cashbook
      if (paidAmount > 0) {
        const expenseEntry: CashbookEntry = {
          id: `cb-${Date.now()}-import`,
          code: generateOrderCode('PC'),
          type: 'expense',
          fund_type: paymentMethod === 'cash' ? 'cash' : 'bank',
          category: 'material',
          amount: paidAmount,
          partner_name: supplierName,
          reference_order_code: refCode,
          note: `Thanh toán tiền nhập kho ${movements.length} dòng hàng (${supplierName})`,
          created_at: now,
        };
        setCashbook((prev) => [expenseEntry, ...prev]);
        db.cashbook.add(expenseEntry).catch(console.warn);
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
      }

      // 2) Nếu debtAmount > 0: tăng nợ nhà cung cấp
      if (debtAmount > 0) {
        let targetSupId = supplierId;
        if (!targetSupId) {
          const found = suppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase());
          if (found) targetSupId = found.id;
        }
        if (targetSupId) {
          setSuppliers((prev) =>
            prev.map((s) => (s.id === targetSupId ? { ...s, current_debt: s.current_debt + debtAmount } : s))
          );
          db.suppliers.get(targetSupId).then((s) => {
            if (s) db.suppliers.update(targetSupId, { current_debt: s.current_debt + debtAmount });
          }).catch(console.warn);
        }
      }

      // 3) Ghi PurchaseOrder local
      const poStatus: PurchaseOrder['status'] = debtAmount <= 0 ? 'completed' : paidAmount <= 0 ? 'debt' : 'partial';
      const poRecord: PurchaseOrder = {
        id: `po-${Date.now()}`,
        code: refCode,
        supplier_id: supplierId,
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
        paid_amount: paidAmount,
        debt_amount: debtAmount,
        status: poStatus,
        created_at: now,
      };
      db.purchaseOrders.add(poRecord).catch(console.warn);

      // 4) Hàng đợi đẩy import op lên server
      await enqueueOp('import', {
        clientRef: `imp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        code: refCode,
        supplierId,
        supplierName,
        total: Math.round(totalAmount),
        paid: paidAmount,
        debt: debtAmount,
        lines: clean.map((l) => {
          const p = products.find((x) => x.id === l.productId);
          return { productId: l.productId, sku: p?.sku || '', quantity: l.quantity, importPrice: l.importPrice };
        }),
      });
      void syncPendingOps();
      return true;
    },
    [products, suppliers, supa, profile, currentShift, setProducts, setSuppliers, setStockMovements, setCashbook, enqueueOp, syncPendingOps]
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
