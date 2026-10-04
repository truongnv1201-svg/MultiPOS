// P3-tx/cart: giỏ POS + tab + modal + tính tiền (tách verbatim từ transactions.tsx).
// Sở hữu: cartTabs/activeTabId/dimensionModalItem/receiptModalOrder/shiftModalOpen/
// posFlow + activeCart/calculatedTotals + tab ops + cart item ops.
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useCommerce } from '../commerce';
import { useCatalog } from '../catalog';
import type { Product, Order, OrderItem, DimensionDetail, PosFlow } from '../../types';
import type { CartTab } from '../types';
import { DEFAULT_TAB } from '../cart';
import { recomputeOrderItem } from '../../db';
import { calcCartTotals } from '../../pricing';
import { notify } from '@/components/common/Toast';

export interface TxCart {
  posFlow: PosFlow;
  setPosFlow: React.Dispatch<React.SetStateAction<PosFlow>>;
  /** Công trình đang chọn ở luồng xuất vật tư — nằm trong store để màn Công trình
   *  nhảy thẳng sang POS (Xuất CT) mà vẫn giữ đúng công trình đã bấm. */
  posProjectId: string | null;
  setPosProjectId: (id: string | null) => void;
  cartTabs: CartTab[];
  activeTabId: string;
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>;
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
  calculatedTotals: ReturnType<typeof calcCartTotals>;
}

export function useTxCart(): TxCart {
  const { shop } = useCommerce();
  const { products } = useCatalog();

  // POS State
  const [posFlow, setPosFlow] = useState<PosFlow>('sale'); // Luồng POS hiện tại
  const [posProjectId, setPosProjectIdState] = useState<string | null>(null);
  const setPosProjectId = useCallback((id: string | null) => {
    setPosProjectIdState(id);
  }, []);
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
      notify('Chỉ được mở tối đa 5 hóa đơn cùng lúc! Hãy thanh toán hoặc đóng bớt tab.', 'error');
      return;
    }
    const newId = `tab-${Date.now()}`;
    // Tên tab lấy số lớn nhất đang có + 1 (không dùng length vì đóng tab giữa
    // chừng sẽ làm length thụt lại và trùng tên, vd: HD 1, HD 3 -> HD 3 mới)
    const maxNum = cartTabs.reduce((m, t) => {
      const n = /^HD (\d+)$/.exec(t.name);
      return n ? Math.max(m, parseInt(n[1], 10)) : m;
    }, 0);
    const newName = `HD ${maxNum + 1}`;
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
  }, [cartTabs, shop.defaultVat, shop.defaultPayment]);

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
      // Chặn SL âm/0/NaN lọt vào giỏ: SL âm trừ tồn thành CỘNG tồn (kho tăng ảo),
      // NaN lan thành subtotal NaN. Ô nhập đã chặn nhưng đây là cửa cuối.
      if (!(quantity > 0)) return;
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
          // SL gộp về <= 0 (dữ liệu cũ) thì gỡ dòng thay vì giữ dòng âm kho
          if (!(newQty > 0)) {
            return { ...tab, items: updatedItems.filter((_, i) => i !== existingIndex), client_ref: undefined };
          }
          updatedItems[existingIndex] = recomputeOrderItem({
            ...current,
            quantity: newQty,
          });
          return { ...tab, items: updatedItems, client_ref: undefined };
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
        // Món trong giỏ đổi -> khóa idempotency của lần checkout hụt trước không còn
        // khớp nội dung giỏ nữa -> xoay khóa mới để server không trả nhầm đơn cũ.
        return { ...tab, items: [...tab.items, computed], client_ref: undefined };
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
        // Bỏ qua SL không dương (âm/0/NaN) nhưng vẫn áp các update khác (sửa giá
        // không được kẹt chỉ vì SL gửi kèm lỗi) — cửa cuối sau ô nhập.
        const { quantity, ...rest } = updates;
        const safeUpdates = quantity !== undefined && !(quantity > 0) ? rest : updates;
        const updatedItems = tab.items.map((item) => {
          if (item.id !== itemId) return item;
          return recomputeOrderItem({ ...item, ...safeUpdates });
        });
        return { ...tab, items: updatedItems, client_ref: undefined };
      });
    },
    [updateActiveTab]
  );

  const removeCartItem = useCallback(
    (itemId: string) => {
      updateActiveTab((tab) => ({
        ...tab,
        items: tab.items.filter((i) => i.id !== itemId),
        client_ref: undefined,
      }));
    },
    [updateActiveTab]
  );

  // Xóa giỏ về tab trắng tương đương tab mới (giữ id/name): reset cả KHÁCH HÀNG
  // (bán nhầm sang đơn mới gây ghi nợ sai người), VAT + phương thức + bảng giá về
  // mặc định cửa hàng. Trước đây chỉ reset hàng/CK/ship -> tên KH cũ dính sang đơn mới.
  const clearActiveCart = useCallback(() => {
    updateActiveTab({
      items: [],
      customer_id: undefined,
      customer_name: 'Khách Lẻ Mua Tại Quầy',
      customer_phone: undefined,
      discount_amount: 0,
      discount_percent: 0,
      shipping_fee: 0,
      shipping_type: 'vnd',
      shipping_percent: 0,
      vat_percent: shop.defaultVat ?? 0,
      price_book: 'retail',
      tendered_amount: 0,
      payment_method: shop.defaultPayment ?? 'cash',
      note: '',
      is_deposit_mode: false,
      client_ref: undefined,
    });
  }, [updateActiveTab, shop.defaultVat, shop.defaultPayment]);

  // Calculations for current active order
  // Tổng giỏ dùng chung lib/pricing (single source, có unit test) — khớp server từng đồng.
  const calculatedTotals = useMemo(() => calcCartTotals(activeCart), [activeCart]);

  return {
    posFlow,
    setPosFlow,
    posProjectId,
    setPosProjectId,
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
  };
}
