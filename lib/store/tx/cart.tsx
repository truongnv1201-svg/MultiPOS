// P3-tx/cart: giỏ POS + tab + modal + tính tiền (tách verbatim từ transactions.tsx).
// Sở hữu: cartTabs/activeTabId/dimensionModalItem/receiptModalOrder/shiftModalOpen/
// posMode/posFlow + activeCart/calculatedTotals + tab ops + cart item ops.
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useCommerce } from '../commerce';
import { useCatalog } from '../catalog';
import type { Product, Order, OrderItem, DimensionDetail } from '../../types';
import type { CartTab } from '../types';
import { DEFAULT_TAB } from '../cart';
import { recomputeOrderItem } from '../../db';
import { calcCartTotals } from '../../pricing';

export interface TxCart {
  posMode: 'standard' | 'fast';
  setPosMode: React.Dispatch<React.SetStateAction<'standard' | 'fast'>>;
  posFlow: 'sale' | 'import';
  setPosFlow: React.Dispatch<React.SetStateAction<'sale' | 'import'>>;
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

export function useTxCart(cashRounding: number): TxCart {
  const { shop } = useCommerce();
  const { products } = useCatalog();

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

  return {
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
  };
}
