// P3-phan 2 (tiep): slice Transactions - POS/gio, checkout, don/no/so quy/ca/nhap kho/cong trinh.
// Tang dieu phoi tien/kho; consume Auth + Commerce + Catalog + Network. Facade useStore() giu nguyen.
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './auth';
import { useCommerce } from './commerce';
import { useCatalog } from './catalog';
import { useNetwork } from './network';
import type { Product, Order, OrderItem, Project, CashbookEntry, Shift, PaymentItem, DimensionDetail, StockMovement } from '../types';
import type { CartTab, ReturnResult, RestockLine, ReturnSkipped } from './types';
import { DEFAULT_TAB } from './cart';
import { toRpcItems } from './rpc';
import { db, generateOrderCode, recomputeOrderItem } from '../db';
import { calcCartTotals, resolvePaidAmount } from '../pricing';
import { INITIAL_ORDERS, INITIAL_PROJECTS, INITIAL_CASHBOOK, INITIAL_SHIFT, INITIAL_STOCK_MOVEMENTS } from '../mock-data';
import { vietnamizeError } from '../error-vi';
import { toast } from '../notify';
import { mapServerOrder, mapServerCashbook } from './realtime-sync';

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
  pendingQueue: Order[];
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
  branchName: string;
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
  syncPendingOrders: () => Promise<void>;
  resolveServerOrderId: (order: Order) => Promise<string | null>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  returnOrder: (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]) => Promise<ReturnResult>;
  collectDebt: (customerId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  syncDebtsFromServer: () => Promise<{ updated: number; skipped: number }>;
  paySupplierDebt: (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  addProject: (project: Omit<Project, 'id' | 'code'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  closeShift: (countedCash: number) => Promise<boolean>;
  openNewShift: (startingCash: number) => Promise<void>;
  refreshShiftFromServer: () => Promise<boolean>;
  refreshOrders: () => Promise<boolean>;
  refreshCashbook: () => Promise<boolean>;
  addCashbookEntry: (entry: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>) => Promise<boolean>;
  importStock: (productId: string, quantity: number, importPrice: number, supplierName?: string, note?: string) => Promise<void>;
  importStockBatch: (
    lines: { productId: string; quantity: number; importPrice: number }[],
    supplierName?: string,
    note?: string
  ) => Promise<boolean>;
}

const TransactionsContext = createContext<TransactionsSlice | null>(null);

// UUID idempotency cho checkout/replay (0029) — stable qua retry, xoay sau success.
function newClientUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fallback bên dưới */
  }
  return `uuid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { shop, cashRounding } = useCommerce();
  const { products, setProducts, suppliers, setSuppliers, customers, setCustomers, customerMap, syncCustomers, refreshCatalog } = useCatalog();
  const { isOnline } = useNetwork();
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [cashbook, setCashbook] = useState<CashbookEntry[]>(INITIAL_CASHBOOK);
  const [currentShift, setCurrentShift] = useState<Shift>(INITIAL_SHIFT);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(INITIAL_STOCK_MOVEMENTS);

  const [branchName] = useState<string>('Chi nhánh 1 (Tổng kho)');
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
      toast('Chỉ được mở tối đa 5 hóa đơn cùng lúc! Hãy thanh toán hoặc đóng bớt tab.');
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
      checkout_uuid: undefined, // xoay idempotency key cho lần bán sau (0029)
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
        toast('Vui lòng đăng nhập thu ngân trước khi thanh toán!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        toast('Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới (F12) trước khi bán hàng.');
        setShiftModalOpen(true);
        return null;
      }

      const totals = calculatedTotals;
      let orderCode = generateOrderCode('HD');
      // P0/0029: idempotency key stable cho lần checkout này — giữ trên tab để retry
      // (RPC thành công nhưng rớt response) không tạo đơn trùng; xoay sau success.
      let clientUuid = activeCart.checkout_uuid;
      if (!clientUuid) {
        clientUuid = newClientUuid();
        updateActiveTab({ checkout_uuid: clientUuid });
      }
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
          // 0023/0028: server tính VAT riêng qua p_vat_percent (khớp calculatedTotals).
          // P1: single-path — KHÔNG fallback gộp VAT vào ship (cách cũ giữ total nhưng
          // làm sai cột thuế trên server mới). Server chưa migrate -> PostgREST PGRST202
          // -> báo migrate thay vì commit sai.
          // P1: kẹp CK/ship/VAT trước khi gửi (server 0028 clamp lại — defense in depth).
          const rpcBase = {
            p_customer_name: activeCart.customer_name || 'Khách Lẻ Mua Tại Quầy',
            p_items: toRpcItems(activeCart.items),
            p_discount: Math.max(0, totals.discount_amount || 0),
            p_payments: rpcPayments,
            p_note: activeCart.note || null,
            p_shipping_fee: Math.max(0, totals.shipping_fee || 0),
            p_is_deposit: isDeposit,
            p_customer_id: serverCustId,
            p_client_uuid: clientUuid,
          };
          let data: any = null;
          let rpcError: any = null;
          const first = await supa.rpc('pos_checkout', {
            ...rpcBase,
            p_vat_percent: Math.min(Math.max(0, activeCart.vat_percent || 0), 100),
          });
          if (first.error && /PGRST202|could not find.*function|schema cache/i.test(first.error.message || '')) {
            throw new Error('Server chưa lên migration 0029 (thiếu p_client_uuid). Chạy apply-one.mjs 0029_checkout_idempotent.sql rồi thử lại — giỏ được giữ nguyên.');
          }
          data = first.data;
          rpcError = first.error;
          if (rpcError) throw new Error(rpcError.message);
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
            duplicate?: boolean; // true khi retry trúng đơn đã tạo (0029) — tiền đã đúng
          };
          if (res.duplicate) {
            console.warn('Checkout retry trúng đơn đã tạo (idempotent, 0029):', res.order_code);
          }
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
          toast(`Lỗi commit server — giữ nguyên giỏ để thử lại: ${vietnamizeError(err)}`);
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
        id: `ord-${Date.now()}`,
        server_id: serverOrderId ?? undefined,
        client_uuid: clientUuid,
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
        branch_name: branchName,
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

        // Regular item or area item (account for waste_factor)
        const qtyToDeduct = item.material_consumed || item.quantity;
        stockDeductions[item.product_id] = (stockDeductions[item.product_id] || 0) + qtyToDeduct;
      }

      // Update in-memory and DB stock
      setProducts((prev) =>
        prev.map((p) => {
          const deduct = stockDeductions[p.id];
          if (deduct) {
            const nextStock = Math.max(0, Math.round((p.stock_quantity - deduct) * 100) / 100);
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

      // Show receipt modal
      setReceiptModalOrder(newOrder);

      return newOrder;
    },
    [
      activeCart,
      calculatedTotals,
      cashierName,
      branchName,
      isOnline,
      supa,
      user,
      currentShift,
      customerMap,
      syncCustomers,
      products,
      clearActiveCart,
      updateActiveTab,
      setLoginOpen,
      setCustomers,
      setProducts,
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
      for (const o of pendingQueue) {
        try {
          // P1 single-path replay: luôn gửi VAT riêng (0023/0028). Đơn offline cũ không
          // có vat_* được coi như VAT 0% — KHÔNG gộp residual vào ship (cách cũ giữ
          // total nhưng làm sai cột thuế). Lệch total đơn legacy chấp nhận được so với
          // sai báo cáo thuế; queue là tạm thời.
          const oVatPct = Math.min(Math.max(0, o.vat_percent || 0), 100);
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
            p_discount: Math.max(0, o.discount_amount || 0),
            p_payments:
              payMethod === 'debt' || replayTendered <= 0
                ? []
                : [{ method: payMethod, amount: replayTendered }],
            p_note: o.note || null,
            p_shipping_fee: Math.max(0, o.shipping_fee || 0),
            p_is_deposit: o.status === 'deposit_order',
            p_customer_id: o.customer_id ? customerMap[o.customer_id] ?? null : null,
            p_client_uuid: o.client_uuid ?? null,
          };
          // Đơn offline cũ chưa có uuid -> cấp 1 lần rồi persist (Dexie + state) để
          // retry/replay sau dùng cùng key, không tạo đơn trùng (0029)
          if (!replayBase.p_client_uuid) {
            const freshUuid = newClientUuid();
            replayBase.p_client_uuid = freshUuid;
            db.pendingOrders.update(o.id, { client_uuid: freshUuid }).catch(() => {});
            db.orders.update(o.id, { client_uuid: freshUuid }).catch(() => {});
            setPendingQueue((prev) => prev.map((p) => (p.id === o.id ? { ...p, client_uuid: freshUuid } : p)));
            setOrders((prev) => prev.map((ord) => (ord.id === o.id ? { ...ord, client_uuid: freshUuid } : ord)));
          }
          const { error } = await supa.rpc('pos_checkout', {
            ...replayBase,
            p_vat_percent: oVatPct,
          });
          if (error) throw error;
          try {
            await db.pendingOrders.delete(o.id);
          } catch {
            /* best-effort */
          }
          syncedIds.push(o.id);
        } catch (err) {
          console.warn('Replay đơn offline thất bại, giữ lại thử sau:', (o as Order).order_code, err);
          remaining.push(o); // giữ lại để thử đợt sau
        }
      }
      setPendingQueue(remaining);
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
  }, [isOnline, pendingQueue, supa, customerMap, refreshCatalog, setPendingQueue, setOrders]);

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
        toast('Vui lòng đăng nhập trước khi hủy đơn!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        toast('Ca đã đóng! Không được hủy/trả đơn sau khi kết ca.');
        return false;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.status === 'cancelled' || order.status === 'returned') return false;

      const serverId = await resolveServerOrderId(order);
      if (serverId && !isOnline) {
        toast('Đơn này đã đồng bộ server nhưng đang ngoại tuyến — không thể hủy lúc này để tránh lệch kho/nợ. Hãy online rồi thử lại.');
        return false;
      }
      if (serverId && supa) {
        try {
          const { error } = await supa.rpc('cancel_order', { p_order_id: serverId });
          if (error) throw new Error(error.message);
        } catch (err: any) {
          toast(`Hủy đơn server thất bại — giữ nguyên đơn để thử lại: ${vietnamizeError(err)}`);
          return false;
        }
      }

      // 1. Restore stock (mirror server 0024: hàng thường theo material_consumed + combo con theo BOM)
      const restoreQty: Record<string, number> = {};
      for (const item of order.items) {
        if (item.product_type === 'service' || item.product_type === 'combo') continue;
        restoreQty[item.product_id] = (restoreQty[item.product_id] || 0) + (item.material_consumed || item.quantity);
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
        toast('Vui lòng đăng nhập trước khi trả hàng!');
        setLoginOpen(true);
        return fail;
      }
      if (currentShift.status !== 'open') {
        toast('Ca đã đóng! Không được hủy/trả đơn sau khi kết ca.');
        return fail;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order) return fail;
      // 0026: chỉ đơn hiệu lực mới trả được (chặn trả lặp cả khi gọi trực tiếp hàm)
      if (order.status !== 'completed' && order.status !== 'deposit_order') {
        toast('Đơn này đã hủy/trả rồi — không xử lý lặp.');
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
        toast('Đơn này đã đồng bộ server nhưng đang ngoại tuyến — không thể trả hàng lúc này để tránh lệch nợ. Hãy online rồi thử lại.');
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
          toast(`Trả hàng server thất bại — giữ nguyên đơn để thử lại: ${vietnamizeError(err)}`);
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
        toast('Vui lòng đăng nhập trước khi thu nợ!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        toast('Ca đã đóng! Không được thu nợ sau khi kết ca. Vui lòng mở ca mới (F12).');
        return false;
      }
      const customer = customers.find((c) => c.id === customerId);
      if (!customer || amount <= 0) return false;

      // 0024: KH đã link server + online -> RPC collect_debt (server clamp theo nợ thật,
      // local mirror theo số server trả về + refresh truth). KH server mà offline -> CHẶN.
      const serverCustId = customerMap[customerId] ?? null;
      if (serverCustId && !isOnline) {
        toast('Khách hàng đã đồng bộ server nhưng đang ngoại tuyến — không thể thu nợ lúc này để tránh lệch công nợ. Hãy online rồi thử lại.');
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
          toast(`Thu nợ server thất bại — giữ nguyên để thử lại: ${vietnamizeError(err)}`);
          return false;
        }
      }

      const actualCollect = serverCollected ?? Math.min(amount, customer.current_debt);
      if (actualCollect <= 0) {
        toast('Không còn nợ phải thu (server báo KH đã hết nợ).');
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
      toast('Vui lòng đăng nhập trước khi đồng bộ công nợ!');
      setLoginOpen(true);
      return { updated: 0, skipped: 0 };
    }
    if (!isOnline) {
      toast('Đang ngoại tuyến — không thể đồng bộ công nợ. Hãy online rồi thử lại.');
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
      toast(`Đồng bộ công nợ thất bại: ${vietnamizeError(err)}`);
      return { updated: 0, skipped };
    }
  }, [supa, user, isOnline, customers, customerMap, setLoginOpen, setCustomers]);

  // Master Data Add/Update hàng hóa/KH/NCC sống ở CatalogProvider (useCatalog) —
  // ở đây chỉ còn nghiệp vụ chi trả NCC (đụng sổ quỹ -> thuộc tầng Transactions).
  const paySupplierDebt = useCallback(
    async (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string): Promise<boolean> => {
      // P2: thu ngân/worker không được chi trả NCC
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        toast('Chỉ Admin/Quản lý được chi trả nợ NCC!');
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
        category: 'material',
        amount,
        partner_name: supplier.name,
        note: `Chi trả nợ NCC ${supplier.name}: ${note}`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      await db.cashbook.add(expenseEntry);
      return true;
    },
    [suppliers, supa, profile, setSuppliers]
  );

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
      return newProj;
    },
    []
  );

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    await db.projects.update(id, updates);
  }, []);

  const closeShift = useCallback(
    async (countedCash: number): Promise<boolean> => {
      // Fix thu ngân: bắt buộc đăng nhập + ca đang mở mới được kết ca.
      if (supa && !user) {
        toast('Vui lòng đăng nhập thu ngân trước khi kết ca!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        toast('Không có ca đang mở! Ca này đã được kết trước đó.');
        return false;
      }
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        toast('Số tiền kiểm đếm không hợp lệ!');
        return false;
      }
      // Invariant 4 & OFF-ERR-01 Check:
      if (!isOnline || pendingQueue.length > 0) {
        toast(
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
          toast(`Kết ca server thất bại — giữ nguyên ca để thử lại: ${vietnamizeError(err)}`);
          return false;
        }
      }

      const diff = countedCash - currentShift.expected_cash;
      const closedShift: Shift = {
        ...currentShift,
        cashier_name: cashierName,
        status: 'closed',
        closed_at: new Date().toISOString(),
        counted_cash: countedCash,
        cash_difference: diff,
      };

      setCurrentShift(closedShift);
      await db.shifts.put(closedShift);
      return true;
    },
    [isOnline, pendingQueue.length, currentShift, supa, user, cashierName, setLoginOpen]
  );

  const openNewShift = useCallback(
    async (startingCash: number) => {
      if (supa && !user) {
        toast('Vui lòng đăng nhập trước khi mở ca!');
        setLoginOpen(true);
        return;
      }
      if (currentShift.status === 'open') {
        toast('Ca hiện tại vẫn đang mở! Hãy kết ca (F12) trước khi mở ca mới.');
        return;
      }
      if (!Number.isFinite(startingCash) || startingCash < 0) {
        toast('Tiền đầu ca không hợp lệ!');
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
          toast(`Mở ca server thất bại — giữ nguyên để thử lại: ${vietnamizeError(err)}`);
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

  // Realtime & Sync: Tải danh sách đơn hàng (kèm items) từ Supabase
  const refreshOrders = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const { data, error } = await supa
        .from('orders')
        .select('*, order_items(*)')
        .order('created_at', { ascending: false });
      if (error || !data) return false;
      const mapped = (data as any[]).map(mapServerOrder);
      setOrders(mapped);
      try {
        await db.orders.clear();
        await db.orders.bulkAdd(mapped);
      } catch {
        /* best-effort */
      }
      return true;
    } catch {
      return false;
    }
  }, [supa]);

  // Realtime & Sync: Tải sổ quỹ từ Supabase
  const refreshCashbook = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const { data, error } = await supa
        .from('cashbook_entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (error || !data) return false;
      const mapped = (data as any[]).map(mapServerCashbook);
      setCashbook(mapped);
      try {
        await db.cashbook.clear();
        await db.cashbook.bulkAdd(mapped);
      } catch {
        /* best-effort */
      }
      return true;
    } catch {
      return false;
    }
  }, [supa]);

  const addCashbookEntry = useCallback(
    async (entryData: Omit<CashbookEntry, 'id' | 'code' | 'created_at'>): Promise<boolean> => {
      if (supa && !user) {
        toast('Vui lòng đăng nhập trước khi lập phiếu thu/chi!');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        toast('Ca đã đóng! Không được lập phiếu thu/chi sau khi kết ca.');
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
      return true;
    },
    [supa, user, currentShift, setLoginOpen]
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
        toast('Chỉ Admin/Quản lý được nhập kho!');
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
    },
    [products, supa, profile, setProducts]
  );

  // Nhập 1 phiếu nhiều dòng cùng NCC: chung 1 mã NH + 1 phiếu chi tổng.
  // Dòng trùng 1 mặt hàng được cộng dồn (MAC tính nối tiếp theo thứ tự dòng).
  const importStockBatch = useCallback(
    async (
      lines: { productId: string; quantity: number; importPrice: number }[],
      supplierName: string = 'Nhà Cung Cấp',
      note: string = 'Nhập kho hàng hóa'
    ): Promise<boolean> => {
      // P2: thu ngân/worker không được nhập kho (khi có Supabase).
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        toast('Chỉ Admin/Quản lý được nhập kho!');
        return false;
      }
      const clean = lines.filter((l) => {
        const p = products.find((x) => x.id === l.productId);
        return p && l.quantity > 0 && l.importPrice > 0;
      });
      if (clean.length === 0) {
        toast('Phiếu nhập chưa có dòng hàng hợp lệ (chọn hàng, SL và đơn giá > 0)!');
        return false;
      }
      const refCode = generateOrderCode('NH');
      const now = new Date().toISOString();
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
        note: `Thanh toán tiền nhập kho ${movements.length} dòng hàng (${supplierName})`,
        created_at: now,
      };
      setCashbook((prev) => [expenseEntry, ...prev]);
      db.cashbook.add(expenseEntry).catch(console.warn);
      return true;
    },
    [products, supa, profile, setProducts]
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
    branchName,
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
    syncPendingOrders,
    resolveServerOrderId,
    cancelOrder,
    returnOrder,
    collectDebt,
    syncDebtsFromServer,
    paySupplierDebt,
    addProject,
    updateProject,
    closeShift,
    openNewShift,
    refreshShiftFromServer,
    refreshOrders,
    refreshCashbook,
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
