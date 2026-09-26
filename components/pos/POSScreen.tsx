'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { Product, OrderItem } from '@/lib/types';
import { ProductSearchBar, ProductSearchBarHandle } from '@/components/pos/ProductSearchBar';
import { MobilePOSDock } from '@/components/pos/MobilePOSDock';
import MobileCartSheet from '@/components/pos/MobileCartSheet';
import { POSQuickCustomerModal } from '@/components/pos/POSQuickCustomerModal';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { NumberInput } from '@/components/common/NumberInput';
import { notify } from '@/components/common/Toast';
import { isVietqrReady, buildVietqrUrl, vietqrAddInfo } from '@/lib/vietqr';
import { formatVND, formatNumber, handleMoneyInputChange } from '@/lib/format';
import { vietnamizeError } from '@/lib/error-vi';
import { resolvePaidAmount } from '@/lib/pricing';
import {
  Plus,
  X,
  Trash2,
  Edit3,
  User,
  CreditCard,
  Banknote,
  QrCode,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Percent,
  Truck,
  AlertCircle,
  CheckCircle2,
  Grid,
  ListFilter,
  Check,
} from 'lucide-react';

// Tab lọc lưới sản phẩm theo Loại hàng (thay cho tab Danh mục đã bỏ)
const PRODUCT_TYPE_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'area', label: 'Diện tích' },
  { key: 'goods', label: 'Thường' },
  { key: 'combo', label: 'Combo lắp ráp' },
  { key: 'service', label: 'Dịch vụ' },
];

export function POSScreen() {
  const {
    products,
    customers,
    suppliers,
    activeCart,
    cartTabs,
    activeTabId,
    setActiveTabId,
    createCartTab,
    closeCartTab,
    updateActiveTab,
    addItemToCart,
    updateCartItem,
    removeCartItem,
    clearActiveCart,
    setDimensionModalItem,
    dimensionModalItem,
    receiptModalOrder,
    shiftModalOpen,
    calculatedTotals,
    checkoutActiveOrder,
    posMode,
    setPosMode,
    posFlow,
    setPosFlow,
    setFlyoutMenuOpen,
    vietqr,
    currentShift,
    user,
    profile,
    supabaseReady,
    setShiftModalOpen,
    setLoginOpen,
    authReady,
    importStockBatch,
    addSupplier,
  } = useStore();

  const [selectedType, setSelectedType] = useState<string>('all');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState<boolean>(false);
  // Checkout xong (hóa đơn hiện) thì ô tìm KH phải trắng theo giỏ mới — trước đây
  // chữ gõ dở còn đọng lại, che mất tên "Khách Lẻ Mua Tại Quầy" của đơn mới.
  // (defer microtask theo idiom chung của repo để khỏi set-state-in-effect)
  useEffect(() => {
    if (receiptModalOrder) {
      Promise.resolve().then(() => {
        setCustomerSearch('');
        setIsCustomerDropdownOpen(false);
      });
    }
  }, [receiptModalOrder]);
  const [discountType, setDiscountType] = useState<'vnd' | 'percent'>('percent');
  const [shippingType, setShippingType] = useState<'vnd' | 'percent'>('vnd');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  // Hydration guard: authReady=false ở cả server lẫn client lần đầu render,
  // nên cảnh báo "chưa đăng nhập" render giống nhau hai phía (không còn mismatch).
  // (supabaseReady/user đơn thuần khác nhau SSR vs CSR -> lỗi hydration, dev badge "1 Issue".)
  const needLogin = authReady && supabaseReady && !user;
  // Mobile cart sheet (bán hàng) — mở từ MobilePOSDock, thay cho cuộn tới bảng ngang
  const [isMobileCartOpen, setIsMobileCartOpen] = useState<boolean>(false);

  // Ô số lượng nhanh được lift lên đây để render ở vị trí cố định trong toolbar
  // (tránh bị đẩy khi thêm/xóa tab hóa đơn)
  const [quickQuantity, setQuickQuantity] = useState<number>(1);
  const quickQuantityRef = useRef<HTMLInputElement>(null);
  /** Ref đến ProductSearchBar để gọi handleQuantityKeyDown khi ô SL render ở ngoài */
  const searchBarRef = useRef<ProductSearchBarHandle>(null);

  // Quick customer modal: state mở/đóng ở đây, form + lưu trong POSQuickCustomerModal
  const [isQuickCustomerModalOpen, setIsQuickCustomerModalOpen] = useState<boolean>(false);

  // Chế độ Nhập hàng trong POS: giỏ nhập RIÊNG (không đụng giỏ bán cartTabs).
  // Chỉ Admin/Quản lý thấy nút chuyển (local-only thì ai cũng được, giống importStock).
  // posFlow sống ở store để màn khác (Kho) nhảy thẳng vào luồng nhập.
  const isImportFlow = posFlow === 'import';
  // Hydration guard: authReady=false ở cả server lẫn client lần đầu render,
  // nên nút Bán/Nhập render giống nhau hai phía (false -> ẩn), hiện sau khi auth resolve.
  const canImport = authReady && (!supabaseReady || profile?.role === 'admin' || profile?.role === 'manager');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setPosMode('standard');
    }
  }, [setPosMode]);
  interface ImportLine {
    key: string;
    productId: string;
    qty: number;
    price: number;
  }
  const [impLines, setImpLines] = useState<ImportLine[]>([]);
  const [impSupplier, setImpSupplier] = useState<string>('');
  const [impNote, setImpNote] = useState<string>('');
  const [impPaymentMethod, setImpPaymentMethod] = useState<'cash' | 'transfer' | 'debt' | 'partial'>('cash');
  const [impPaidAmount, setImpPaidAmount] = useState<number>(0);

  // Quick supplier modal
  const [isQuickSupplierModalOpen, setIsQuickSupplierModalOpen] = useState<boolean>(false);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supTaxCode, setSupTaxCode] = useState('');
  const [supCreating, setSupCreating] = useState(false);

  const matchedSupplier = React.useMemo(() => {
    if (!impSupplier.trim()) return null;
    const target = impSupplier.trim().toLowerCase();
    return suppliers.find(
      (s) => s.name.toLowerCase() === target || s.code.toLowerCase() === target
    ) || null;
  }, [suppliers, impSupplier]);

  const addImportLine = useCallback(
    (product: Product, qty: number) => {
      if (product.product_type === 'service' || product.product_type === 'combo') {
        notify('Hàng dịch vụ/combo không nhập kho! Chọn hàng hóa hoặc hàng diện tích.', 'error');
        return;
      }
      const q = qty > 0 ? qty : 1;
      setImpLines((prev) => {
        const found = prev.find((l) => l.productId === product.id);
        if (found) return prev.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + q } : l));
        return [...prev, { key: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, productId: product.id, qty: q, price: product.import_price }];
      });
    },
    []
  );

  const impTotal = React.useMemo(
    () => impLines.reduce((s, l) => s + (l.qty || 0) * (l.price || 0), 0),
    [impLines]
  );

  // Preview giá vốn MAC nối tiếp theo thứ tự dòng (giống hệt importStockBatch trong store).
  // Để user thấy trước vốn cũ -> vốn mới trước khi bấm Nhập kho.
  const impPreview = React.useMemo(() => {
    const running = new Map(products.map((p) => [p.id, { stock: p.stock_quantity, avg: p.avg_cost }]));
    return impLines.map((line) => {
      const cur = running.get(line.productId);
      if (!cur) return { key: line.key, oldAvg: 0, newAvg: line.price || 0, oldStock: 0, newStock: line.qty || 0 };
      const oldAvg = cur.avg || 0;
      const oldStock = cur.stock || 0;
      const qty = line.qty || 0;
      const price = line.price || 0;
      const newStock = oldStock + qty;
      const newAvg = newStock > 0 ? Math.round((oldStock * oldAvg + qty * price) / newStock) : price;
      running.set(line.productId, { stock: newStock, avg: newAvg });
      return { key: line.key, oldAvg, newAvg, oldStock, newStock };
    });
  }, [impLines, products]);

  const handleImportCommit = useCallback(async () => {
    if (impLines.length === 0) {
      notify('Phiếu nhập chưa có dòng hàng nào!', 'error');
      return;
    }

    let paid = impTotal;
    if (impPaymentMethod === 'debt') {
      paid = 0;
    } else if (impPaymentMethod === 'partial') {
      paid = Math.max(0, Math.min(impTotal, impPaidAmount || 0));
    }

    if ((impPaymentMethod === 'debt' || impPaymentMethod === 'partial') && !impSupplier.trim()) {
      notify('Vui lòng chọn hoặc nhập tên Nhà cung cấp để ghi nợ!', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const ok = await importStockBatch(
        impLines.map((l) => ({ productId: l.productId, quantity: l.qty, importPrice: l.price })),
        impSupplier.trim() || 'Nhà Cung Cấp',
        impNote.trim() || 'Nhập kho hàng hóa',
        {
          paymentMethod: impPaymentMethod,
          paidAmount: paid,
          supplierId: matchedSupplier?.id,
        }
      );
      if (ok) {
        setImpLines([]);
        setImpSupplier('');
        setImpNote('');
        setImpPaidAmount(0);
        notify('Nhập kho thành công! Tồn kho, MAC, công nợ và sổ quỹ đã cập nhật.', 'success');
      }
    } finally {
      setIsProcessing(false);
    }
  }, [impLines, impSupplier, impNote, impPaymentMethod, impPaidAmount, impTotal, matchedSupplier, importStockBatch]);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;
    setSupCreating(true);
    try {
      await addSupplier({
        name: supName.trim(),
        phone: supPhone.trim(),
        address: supAddress.trim(),
        tax_code: supTaxCode.trim() || undefined,
        current_debt: 0,
        credit_limit: 100000000,
      });
      setImpSupplier(supName.trim());
      setIsQuickSupplierModalOpen(false);
      setSupName('');
      setSupPhone('');
      setSupAddress('');
      setSupTaxCode('');
    } finally {
      setSupCreating(false);
    }
  };

  // Input refs for keyboard shortcuts
  const customerInputRef = useRef<HTMLInputElement>(null);
  const shippingInputRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);
  const tenderedInputRef = useRef<HTMLInputElement>(null);

  const handleCheckout = useCallback(async () => {
    if (activeCart.items.length === 0) {
      notify('Giỏ hàng chưa có sản phẩm nào!', 'error');
      return;
    }
    // Tiền mặt: bắt buộc nhập tiền khách đưa (ô trống không được coi là trả đủ)
    if (activeCart.payment_method === 'cash' && (!activeCart.tendered_amount || activeCart.tendered_amount <= 0)) {
      notify('Vui lòng nhập Số tiền khách đưa (F9) khi thanh toán bằng tiền mặt!', 'error');
      tenderedInputRef.current?.focus();
      tenderedInputRef.current?.select();
      return;
    }
    // Chặn nợ vô chủ: khách lẻ tại quầy (chưa chọn hồ sơ KH) không được để lại công nợ,
    // kể cả bấm nhầm Ghi nợ hay trả thiếu tiền mặt.
    // (Tính nợ hiệu dụng y hệt checkout — chung lib/pricing, cấm implement riêng)
    const effPaid = resolvePaidAmount(calculatedTotals.payable, activeCart.payment_method, activeCart.tendered_amount || 0);
    if (calculatedTotals.payable - effPaid > 0 && !activeCart.customer_id) {
      notify('Không thể ghi nợ cho khách lẻ chưa có hồ sơ! Vui lòng chọn hoặc thêm khách hàng (F4) trước khi thanh toán.', 'error');
      customerInputRef.current?.focus();
      customerInputRef.current?.select();
      return;
    }
    setIsProcessing(true);
    try {
      await checkoutActiveOrder(false);
    } catch (err: any) {
      notify(`Lỗi thanh toán: ${vietnamizeError(err)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [activeCart.items.length, activeCart.customer_id, activeCart.payment_method, activeCart.tendered_amount, calculatedTotals.payable, checkoutActiveOrder]);

  const handleDepositOrder = useCallback(async () => {
    if (activeCart.items.length === 0) {
      notify('Giỏ hàng chưa có sản phẩm nào để nhận cọc!', 'error');
      return;
    }
    const depositAmount = activeCart.tendered_amount;
    if (!depositAmount || depositAmount <= 0) {
      notify('Vui lòng nhập Số tiền cọc khách đưa (F9) trước khi tạo đơn Đặt hàng / Nhận cọc!', 'error');
      tenderedInputRef.current?.focus();
      return;
    }
    // Đơn cọc luôn còn phần phải thu -> cũng bắt buộc có hồ sơ KH
    if (!activeCart.customer_id) {
      notify('Đơn đặt hàng / nhận cọc bắt buộc phải có hồ sơ khách hàng! Vui lòng chọn hoặc thêm khách hàng (F4).', 'error');
      customerInputRef.current?.focus();
      customerInputRef.current?.select();
      return;
    }
    setIsProcessing(true);
    try {
      await checkoutActiveOrder(true);
    } catch (err: any) {
      notify(`Lỗi tạo đơn cọc: ${vietnamizeError(err)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [activeCart.items.length, activeCart.tendered_amount, activeCart.customer_id, checkoutActiveOrder]);

  // Keyboard shortcut listener for POS (ma trận SRS §4.4: F2–F10, Ctrl+F9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard: khi modal F3 / receipt / F12 đang mở, chỉ modal đó xử lý phím
      // (tránh F10 checkout đè khi đang nhập quy cách m²)
      const isModalOpen = dimensionModalItem !== null || receiptModalOrder !== null || shiftModalOpen;
      if (isModalOpen) return;

      // Chế độ Nhập hàng: chỉ F10 (nhập kho); phím bán hàng tạm nghỉ để khỏi nhầm giỏ
      if (posFlow === 'import') {
        if (e.key === 'F10') {
          e.preventDefault();
          handleImportCommit();
        }
        return;
      }

      // F2: Switch POS Mode (Standard vs Fast)
      if (e.key === 'F2') {
        e.preventDefault();
        setPosMode((prev) => (prev === 'standard' ? 'fast' : 'standard'));
        return;
      }

      // F3: Mở / sửa Modal m² — dòng area gần nhất trong giỏ; nếu chưa có thì về F1
      if (e.key === 'F3') {
        e.preventDefault();
        const lastArea = [...activeCart.items].reverse().find((i) => i.product_type === 'area');
        if (lastArea) {
          setDimensionModalItem({ item: lastArea, isNew: false });
        } else {
          document.getElementById('f1-search-input')?.focus();
        }
        return;
      }

      // F4: Focus Customer
      if (e.key === 'F4') {
        e.preventDefault();
        customerInputRef.current?.focus();
        customerInputRef.current?.select();
        return;
      }

      // F6: Focus Shipping
      if (e.key === 'F6') {
        e.preventDefault();
        shippingInputRef.current?.focus();
        shippingInputRef.current?.select();
        return;
      }

      // F7: Next Cart Tab
      if (e.key === 'F7') {
        e.preventDefault();
        const currentIndex = cartTabs.findIndex((t) => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % cartTabs.length;
        setActiveTabId(cartTabs[nextIndex].id);
        return;
      }

      // F8: Focus Discount
      if (e.key === 'F8') {
        e.preventDefault();
        discountInputRef.current?.focus();
        discountInputRef.current?.select();
        return;
      }

      // F9: Focus Tendered Amount
      if (e.key === 'F9' && !e.ctrlKey) {
        e.preventDefault();
        tenderedInputRef.current?.focus();
        tenderedInputRef.current?.select();
        return;
      }

      // Ctrl + F9: Deposit Order Mode
      if (e.ctrlKey && e.key === 'F9') {
        e.preventDefault();
        handleDepositOrder();
        return;
      }

      // F10: Checkout
      if (e.key === 'F10') {
        e.preventDefault();
        handleCheckout();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cartTabs, activeTabId, activeCart.items, dimensionModalItem, receiptModalOrder, shiftModalOpen, setPosMode, setActiveTabId, setDimensionModalItem, handleCheckout, handleDepositOrder, posFlow, handleImportCommit]);

  // Filtered products for grid — lọc theo Loại hàng (Danh mục đã bỏ, dùng product_type)
  const displayedProducts = React.useMemo(() => {
    if (selectedType === 'all') return products;
    return products.filter((p) => p.product_type === selectedType);
  }, [products, selectedType]);

  // Filtered customers
  const filteredCustomers = React.useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase().trim();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const activeCustomer = customers.find((c) => c.id === activeCart.customer_id);

  // Quick tender presets
  const setQuickTender = (amount: number) => {
    updateActiveTab({ tendered_amount: amount });
  };

  return (
    <div id="pos-screen" className="flex-1 flex flex-col lg:flex-row h-full min-h-0 bg-slate-100 overflow-hidden pos-mobile-bottom-space">
      {/* LEFT COLUMN: Order Tabs + Cart Items Table + Product Grid (if standard) */}
      <div className="flex-1 flex flex-col border-r border-slate-200 min-w-0 min-h-0 bg-white">
        {/* Toolbar: CSS Grid 3 cột — [search+qty | tabs (1fr) | controls] */}
        <div
          id="pos-goods-toolbar"
          className="bg-white border-b border-slate-200 px-2 py-1.5 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] items-center gap-2 shrink-0"
        >
          {/* CỘT 1: Search + Ô SL — kích thước cố định, không bị ảnh hưởng bởi tabs */}
          <div className="flex items-center gap-1.5">
            <ProductSearchBar
              ref={searchBarRef}
              showQuantityInput={false}
              quantity={quickQuantity}
              onQuantityChange={setQuickQuantity}
              quantityInputRef={quickQuantityRef}
              onPickProduct={isImportFlow ? addImportLine : undefined}
            />
            {/* Ô số lượng nhanh */}
            <div className="w-16 sm:w-20 shrink-0">
              <input
                ref={quickQuantityRef}
                id="quick-quantity-input"
                type="text"
                inputMode="numeric"
                value={quickQuantity}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setQuickQuantity(raw === '' ? 0 : parseInt(raw, 10));
                }}
                onFocus={(e) => e.target.select()}
                onBlur={() => setQuickQuantity((q) => (q > 0 ? q : 1))}
                onKeyDown={(e) => searchBarRef.current?.handleQuantityKeyDown(e)}
                placeholder="1"
                title="Số lượng nhanh (Enter để thêm vào giỏ)"
                className="w-full h-10 sm:h-9 px-2 text-center text-xs font-bold bg-white text-amber-600 border border-slate-300 rounded-lg focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* CỘT 2: Tabs hóa đơn (chỉ luồng bán; luồng nhập để trống cho gọn) */}
          {!isImportFlow && (
          <div
            id="order-tabs-group"
            className="flex items-center gap-1 overflow-x-auto min-w-0"
            title="Chuyển Tab hóa đơn (F7)"
          >
            {cartTabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  id={`cart-tab-${tab.id}`}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group h-9 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all border shrink-0 ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  <span>{tab.name}</span>
                  {tab.items.length > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {tab.items.length}
                    </span>
                  )}
                  {cartTabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeCartTab(tab.id);
                      }}
                      className="opacity-60 group-hover:opacity-100 hover:text-rose-500 rounded p-0.5"
                      title="Đóng tab này"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              id="btn-new-tab"
              onClick={createCartTab}
              className="h-9 w-9 shrink-0 text-slate-500 hover:text-blue-700 hover:bg-blue-50 border border-dashed border-slate-300 hover:border-blue-400 rounded-md text-xs flex items-center justify-center transition-colors"
              title="Thêm tab đơn hàng mới (F7)"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          )}
          {isImportFlow && <div className="min-w-0" />}

          {/* CỘT 3: Controls — kích thước cố định theo nội dung, neo phải */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Chuyển luồng Bán / Nhập (chỉ Admin/Quản lý) */}
            {canImport && (
              <div className="flex items-center h-9 bg-slate-100 p-0.5 rounded-md border border-slate-200" title="Chuyển giữa bán hàng và nhập hàng (giỏ bán được giữ nguyên)">
                <button
                  type="button"
                  onClick={() => setPosFlow('sale')}
                  className={`px-2.5 h-full rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
                    !isImportFlow ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Bán hàng
                </button>
                <button
                  type="button"
                  onClick={() => setPosFlow('import')}
                  className={`px-2.5 h-full rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
                    isImportFlow ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  Nhập hàng
                </button>
              </div>
            )}

            {/* Toggle Mode Button [F2] */}
            <button
              id="btn-toggle-pos-mode"
              onClick={() => setPosMode(posMode === 'standard' ? 'fast' : 'standard')}
              className="w-10 sm:w-36 px-1 sm:px-2 h-9 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-medium flex items-center justify-center gap-1.5 border border-slate-200"
              title="Đổi chế độ bán hàng (F2)"
            >
              {posMode === 'standard' ? <Grid className="w-3.5 h-3.5 text-blue-500" /> : <ListFilter className="w-3.5 h-3.5 text-amber-500" />}
              <span className="hidden sm:inline">{posMode === 'standard' ? 'Chế độ Thẻ (F2)' : 'Chế độ Nhanh (F2)'}</span>
            </button>
          </div>
        </div>

        {/* Middle: giỏ Nhập (luồng nhập) hoặc giỏ Bán */}
        {posFlow === 'import' ? (
        <div id="import-table-container" className="flex-1 overflow-auto p-2">
          {impLines.length === 0 ? (
            <div className="h-full min-h-[150px] sm:min-h-[220px] flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-lg p-4 sm:p-6">
              <Truck className="w-10 h-10 sm:w-12 sm:h-12 text-slate-300 mb-2 stroke-1" />
              <p className="text-sm font-medium text-slate-600">Chưa có dòng nhập hàng</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs text-center">
                Tìm hoặc quét mã vạch để thêm hàng vào phiếu.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: record list dòng nhập (bảng ngang chỉ dành cho desktop) */}
              <div className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {impLines.map((line, idx) => {
                  const prod = products.find((p) => p.id === line.productId);
                  if (!prod) return null;
                  return (
                    <div key={line.key} className="px-3 py-2.5 flex items-center gap-3">
                      <span className="w-5 shrink-0 text-center text-[11px] font-mono text-slate-400">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{prod.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {line.qty} {prod?.unit} × {formatVND(line.price)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-mono font-bold text-slate-800">
                        {formatVND(line.qty * line.price)}
                      </span>
                      <button
                        onClick={() => setImpLines((prev) => prev.filter((l) => l.key !== line.key))}
                        className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 bg-rose-50 active:bg-rose-100"
                        aria-label={`Xóa dòng nhập ${prod.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="hidden lg:block border border-slate-200 rounded-lg overflow-hidden shadow-2xs">
              <table className="w-full min-w-[620px] text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-2.5 w-10 text-center">STT</th>
                    <th className="py-2.5 px-2.5">Sản phẩm</th>
                    <th className="py-2.5 px-2.5 w-32 text-right">Đơn giá nhập</th>
                    <th className="py-2.5 px-2.5 w-24 text-center">SL nhập</th>
                    <th className="py-2.5 px-2.5 w-28 text-right">Thành tiền</th>
                    <th className="py-2.5 px-2.5 w-36 text-right" title="Giá vốn bình quân (MAC) dự kiến sau khi nhập: (tồn cũ × vốn cũ + SL × đơn giá) / tồn mới">Giá vốn mới</th>
                    <th className="py-2.5 px-2 w-10 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {impLines.map((line, idx) => {
                    const prod = products.find((p) => p.id === line.productId);
                    if (!prod) return null;
                    const pv = impPreview.find((x) => x.key === line.key);
                    const oldAvg = pv?.oldAvg ?? prod.avg_cost;
                    const newAvg = pv?.newAvg ?? line.price;
                    const changed = oldAvg !== newAvg;
                    return (
                      <tr key={line.key} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-2.5 text-center text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-bold text-slate-800 text-xs">{prod.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            ({prod.sku}) · Tồn: {prod.stock_quantity} {prod.unit} · Vốn cũ: {formatVND(oldAvg)}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5">
                          <NumberInput
                            min={0}
                            value={line.price}
                            onChange={(v) => setImpLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, price: v } : l)))}
                            className="w-full h-7 px-1.5 text-right font-mono text-xs bg-white border border-slate-300 rounded"
                          />
                        </td>
                        <td className="py-2.5 px-2.5">
                          <NumberInput
                            min={0}
                            value={line.qty}
                            onChange={(v) => setImpLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: v } : l)))}
                            className="w-full h-7 px-1.5 text-center font-mono font-bold text-xs bg-white border border-slate-300 rounded"
                          />
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900 text-xs">
                          {formatVND((line.qty || 0) * (line.price || 0))}
                        </td>
                        <td
                          className="py-2.5 px-2.5 text-right font-mono text-xs"
                          title={`MAC: (${pv?.oldStock ?? prod.stock_quantity} × ${oldAvg.toLocaleString('vi-VN')} + ${(line.qty || 0)} × ${(line.price || 0).toLocaleString('vi-VN')}) / ${pv?.newStock ?? prod.stock_quantity}`}
                        >
                          {changed ? (
                            <>
                              <span className="text-slate-400 line-through mr-1">{formatVND(oldAvg)}</span>
                              <span className="font-bold text-emerald-700">→ {formatVND(newAvg)}</span>
                            </>
                          ) : (
                            <span className="font-bold text-slate-700">{formatVND(newAvg)}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <button
                            onClick={() => setImpLines((prev) => prev.filter((l) => l.key !== line.key))}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Xóa dòng"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
        ) : (
        <div id="cart-table-container" className="flex-1 min-h-0 overflow-auto p-2">
          {activeCart.items.length === 0 ? (
            <div className="h-full min-h-[150px] sm:min-h-[220px] flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-lg p-4 sm:p-6">
              <ShoppingBag className="w-10 h-10 sm:w-12 sm:h-12 text-slate-300 mb-2 stroke-1" />
              <p className="text-sm font-medium text-slate-600">Chưa có sản phẩm trong giỏ</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs text-center">
                Tìm hoặc quét mã vạch để bắt đầu bán hàng.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: tóm tắt giỏ, mở record list dạng sheet (bảng ngang chỉ dành cho desktop) */}
              <button
                id="btn-pos-mobile-cart-summary"
                type="button"
                onClick={() => setIsMobileCartOpen(true)}
                className="lg:hidden w-full mb-2 flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 active:bg-blue-100 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-blue-800">
                    {activeCart.items.length} món trong giỏ
                  </span>
                  <span className="block text-[10px] text-blue-700/80">Chạm để xem &amp; sửa giỏ hàng</span>
                </span>
                <span className="shrink-0 text-sm font-mono font-black text-blue-900">
                  {formatVND(calculatedTotals.payable)}
                </span>
              </button>
              <div className="hidden lg:block border border-slate-200 rounded-lg overflow-hidden shadow-2xs">
              <table className="w-full min-w-[620px] text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 select-none">
                    <th className="py-2.5 px-2.5 w-10 text-center">STT</th>
                    <th className="py-2.5 px-2.5">Sản phẩm / Quy cách</th>
                    <th className="py-2.5 px-2.5 w-24 text-right">Đơn giá</th>
                    <th className="py-2.5 px-2.5 w-24 text-center">SL / Diện tích</th>
                    <th className="py-2.5 px-2.5 w-24 text-right">Phí GC (đ)</th>
                    <th className="py-2.5 px-2.5 w-28 text-right">Thành tiền</th>
                    <th className="py-2.5 px-2 w-10 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeCart.items.map((item, idx) => {
                    const isArea = item.product_type === 'area';
                    return (
                      <tr key={item.id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-2.5 px-2.5 text-center text-slate-400 font-mono">
                          {idx + 1}
                        </td>

                        {/* Product info & dimension badge */}
                        <td className="py-2.5 px-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 text-xs">{item.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">({item.sku})</span>
                          </div>

                          {/* Area m2 dimensions summary & F3 shortcut */}
                          {isArea && item.dimension_details && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[10px] font-mono font-medium">
                                {item.dimension_details.length} tấm ({item.quantity.toFixed(3)} m²)
                              </span>
                              <button
                                onClick={() =>
                                  setDimensionModalItem({
                                    item,
                                    isNew: false,
                                  })
                                }
                                className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[10px] font-bold flex items-center gap-1 transition-colors"
                                title="Sửa quy cách tấm cắt (F3)"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Sửa quy cách (F3)</span>
                              </button>
                            </div>
                          )}

                          {/* Combo component preview (P0-5: đọc BOM thật, không hard-code) */}
                          {item.product_type === 'combo' &&
                            (() => {
                              const combo = products.find((p) => p.id === item.product_id);
                              const parts = (combo?.combo_items || []).map((c) => {
                                const cp = products.find((p) => p.id === c.product_id);
                                return `${cp?.name || c.sku} x${c.quantity}`;
                              });
                              return (
                                <div className="text-[10px] text-purple-600 mt-0.5">
                                  {parts.length > 0
                                    ? `Trừ kho linh kiện con: ${parts.join(' + ')} (x${item.quantity})`
                                    : 'Combo chưa cấu hình BOM — kiểm tra lại!'}
                                </div>
                              );
                            })()}
                        </td>

                        {/* Unit price */}
                        <td className="py-2.5 px-2.5 text-right font-mono text-slate-700">
                          {formatVND(item.unit_price)}
                        </td>

                        {/* Quantity / m2 */}
                        <td className="py-2.5 px-2.5 text-center">
                          {isArea ? (
                            <div className="font-bold font-mono text-blue-700 text-xs">
                              {item.quantity.toFixed(3)} <span className="text-[10px] font-normal">m²</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateCartItem(item.id, { quantity: Math.max(1, item.quantity - 1) })}
                                className="w-5 h-6 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold text-xs flex items-center justify-center transition-colors"
                                title="Giảm 1"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateCartItem(item.id, {
                                    quantity: Math.max(1, parseFloat(e.target.value) || 1),
                                  })
                                }
                                className="w-12 h-6 px-1 text-center font-bold font-mono bg-white border border-slate-300 rounded text-slate-800 text-xs focus:border-blue-500 focus:outline-hidden"
                              />
                              <button
                                type="button"
                                onClick={() => updateCartItem(item.id, { quantity: item.quantity + 1 })}
                                className="w-5 h-6 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold text-xs flex items-center justify-center transition-colors"
                                title="Tăng 1"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Processing fee */}
                        <td className="py-2.5 px-2.5 text-right font-mono text-amber-700 font-semibold">
                          {item.processing_fee > 0 ? formatVND(item.processing_fee) : '-'}
                        </td>

                        {/* Subtotal */}
                        <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900 text-xs">
                          {formatVND(item.subtotal)}
                        </td>

                        {/* Delete button */}
                        <td className="py-2.5 px-2 text-center">
                          <button
                            onClick={() => removeCartItem(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Xóa sản phẩm"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
        )}

        {/* Bottom Panel: If in Standard Mode, show Products Grid */}
        {posMode === 'standard' && (
          <div id="product-grid-section" className="h-44 sm:h-64 border-t border-slate-200 bg-slate-50 flex flex-col min-h-0">
            {/* Product-type tabs — thay cho tab Danh mục (đã bỏ) */}
            <div className="px-3 py-1.5 bg-slate-200/70 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
              {PRODUCT_TYPE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSelectedType(t.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedType === t.key
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Grid of product cards */}
            <div className="flex-1 overflow-y-auto p-2.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {displayedProducts.map((prod) => {
                const isArea = prod.product_type === 'area';
                return (
                  <button
                    type="button"
                    key={prod.id}
                    id={`pos-product-card-${prod.sku}`}
                    aria-label={`Thêm ${prod.name}`}
                    onClick={() => {
                      if (isImportFlow) {
                        // Luồng nhập: mọi loại hàng (kể cả m²) thêm theo SL ô nhanh, giá = giá nhập
                        addImportLine(prod, quickQuantity > 0 ? quickQuantity : 1);
                        return;
                      }
                      if (isArea) {
                        // Item trống — Modal F3 làm chủ số liệu (không seed số giả)
                        setDimensionModalItem({
                          item: {
                            id: `item-${Date.now()}`,
                            product_id: prod.id,
                            sku: prod.sku,
                            name: prod.name,
                            product_type: 'area',
                            unit: prod.unit,
                            unit_price: prod.retail_price,
                            quantity: 1,
                            discount_amount: 0,
                            processing_fee: 0,
                            subtotal: 0,
                            waste_factor: prod.waste_factor || 5,
                            dimension_details: undefined,
                          },
                          isNew: true,
                        });
                      } else {
                        addItemToCart(prod, 1);
                      }
                    }}
                    className="p-2 bg-white rounded-lg border border-slate-200 hover:border-blue-500 hover:shadow-sm cursor-pointer flex flex-col justify-between transition-all group"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                            isArea
                              ? 'bg-amber-100 text-amber-800'
                              : prod.product_type === 'combo'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {isArea ? 'm² Quy cách' : prod.unit}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{prod.sku}</span>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-800 line-clamp-2 leading-snug group-hover:text-blue-600">
                        {prod.name}
                      </h4>
                    </div>
                      <div className="mt-2 pt-1 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-600 font-mono" title={isImportFlow ? 'Giá nhập' : 'Giá bán'}>
                          {formatVND(isImportFlow ? prod.import_price : prod.retail_price)}
                        </span>
                      <span className="text-[10px] text-slate-400">
                        Kho: {prod.stock_quantity}
                      </span>
                     </div>
                   </button>
                 );
              })}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: panel Nhập (luồng nhập) hoặc Khách + Thanh toán (luồng bán) */}
      <div
        id="pos-payment-panel"
        className="w-full lg:w-96 bg-slate-50 p-3.5 flex flex-col justify-between border-t lg:border-t-0 border-slate-200 overflow-y-auto select-none min-h-0 max-h-[52dvh] lg:max-h-none"
      >
      {isImportFlow ? (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2.5">
            <div className="text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" />
              Phiếu nhập kho
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">Nhà cung cấp *</label>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="flex-1">
                  <SearchableSelect
                    value={impSupplier}
                    allowCustom
                    placeholder="Gõ để tìm NCC hoặc nhập tên mới…"
                    options={suppliers.map((s) => ({
                      value: s.name,
                      label: s.name,
                      sub: [s.phone, s.address].filter(Boolean).join(' · ') || s.code,
                    }))}
                    onChange={(v) => setImpSupplier(v)}
                  />
                </div>
                <button
                  type="button"
                  id="btn-quick-supplier-modal"
                  onClick={() => setIsQuickSupplierModalOpen(true)}
                  className="h-8 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md text-xs font-bold flex items-center justify-center transition-colors shrink-0"
                  title="Thêm nhanh nhà cung cấp mới (+)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {matchedSupplier && (
                <div className="mt-1.5 text-[11px] flex items-center justify-between text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200 font-medium">
                  <span>Nợ NCC hiện tại:</span>
                  <span className="font-bold font-mono text-rose-600">{formatVND(matchedSupplier.current_debt || 0)}</span>
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">Ghi chú phiếu nhập</label>
              <input
                type="text"
                value={impNote}
                onChange={(e) => setImpNote(e.target.value)}
                placeholder="Số hóa đơn đỏ, xe giao..."
                className="mt-1 w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Phương thức thanh toán cho NCC */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
            <label className="text-[11px] font-bold text-slate-700 uppercase block">
              Hình thức thanh toán NCC
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setImpPaymentMethod('cash')}
                className={`py-1.5 px-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  impPaymentMethod === 'cash'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Tiền mặt</span>
              </button>
              <button
                type="button"
                onClick={() => setImpPaymentMethod('transfer')}
                className={`py-1.5 px-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  impPaymentMethod === 'transfer'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Chuyển khoản</span>
              </button>
              <button
                type="button"
                onClick={() => setImpPaymentMethod('debt')}
                className={`py-1.5 px-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  impPaymentMethod === 'debt'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Nợ 100%</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImpPaymentMethod('partial');
                  if (impPaidAmount === 0) setImpPaidAmount(Math.round(impTotal * 0.5));
                }}
                className={`py-1.5 px-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  impPaymentMethod === 'partial'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Percent className="w-3.5 h-3.5" />
                <span>Trả 1 phần</span>
              </button>
            </div>

            {impPaymentMethod === 'partial' && (
              <div className="pt-2 border-t border-slate-100">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Số tiền trả trước cho NCC
                </label>
                <NumberInput
                  value={impPaidAmount}
                  onChange={(v) => setImpPaidAmount(v)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>
            )}
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span>Số dòng hàng:</span>
              <span className="font-mono font-bold text-slate-800">{impLines.length}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Tổng số lượng:</span>
              <span className="font-mono font-bold text-slate-800">
                {impLines.reduce((s, l) => s + (l.qty || 0), 0)}
              </span>
            </div>
            <div className="flex items-center justify-between font-bold border-t border-slate-200 pt-1.5">
              <span>TỔNG TIỀN NHẬP:</span>
              <span className="font-mono text-blue-700 text-sm">{formatVND(impTotal)}</span>
            </div>
            <div className="pt-1.5 border-t border-slate-100 text-[11px] space-y-1">
              {impPaymentMethod === 'cash' && (
                <div className="text-emerald-700 font-medium">Thanh toán đủ bằng Tiền mặt (Két quầy)</div>
              )}
              {impPaymentMethod === 'transfer' && (
                <div className="text-blue-700 font-medium">Thanh toán đủ bằng Chuyển khoản (Ngân hàng)</div>
              )}
              {impPaymentMethod === 'debt' && (
                <div className="text-rose-700 font-medium">Ghi nợ NCC 100%: +{formatVND(impTotal)} vào công nợ</div>
              )}
              {impPaymentMethod === 'partial' && (
                <div className="space-y-0.5 text-slate-600">
                  <div className="flex justify-between">
                    <span>Đã trả NCC:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {formatVND(Math.max(0, Math.min(impTotal, impPaidAmount || 0)))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ghi nợ còn lại:</span>
                    <span className="font-mono font-bold text-rose-600">
                      {formatVND(Math.max(0, impTotal - Math.max(0, Math.min(impTotal, impPaidAmount || 0))))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          {(currentShift.status !== 'open' || needLogin) && (
            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 leading-relaxed">
              {needLogin ? (
                <>
                  Chưa đăng nhập —{' '}
                  <button onClick={() => setLoginOpen(true)} className="font-bold underline hover:text-amber-700">
                    Đăng nhập
                  </button>{' '}
                  để nhập kho.
                </>
              ) : (
                <>Ca làm việc đã đóng — mở ca mới (F12) để tiếp tục nhập.</>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={isProcessing || impLines.length === 0 || currentShift.status !== 'open' || needLogin}
            onClick={handleImportCommit}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-lg shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Truck className="w-5 h-5" />
            <span>NHẬP KHO (F10)</span>
            <span className="text-xs font-mono font-normal opacity-90">— {formatVND(impTotal)}</span>
          </button>
          {impLines.length > 0 && (
            <button
              type="button"
              onClick={() => setImpLines([])}
              className="w-full py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-lg flex items-center justify-center gap-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa hết dòng nhập</span>
            </button>
          )}
        </div>
      ) : (
        <>
        {activeCart.items.length === 0 && (
          <div className="sm:hidden rounded-xl border border-blue-100 bg-blue-50 p-4 text-center">
            <ShoppingBag className="mx-auto h-8 w-8 text-blue-500" />
            <p className="mt-2 text-sm font-semibold text-slate-800">Thêm sản phẩm để thanh toán</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Thông tin khách và phương thức thanh toán sẽ hiện ở đây.</p>
          </div>
        )}
        <div className={`space-y-3 ${activeCart.items.length === 0 ? 'max-sm:hidden' : ''}`}>
          {/* Customer Selection [F4] */}
          <div className="relative">
            <label className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5 mb-1">
              <User className="w-3.5 h-3.5 text-blue-600" />
              Khách hàng
              <kbd className="hidden sm:inline-flex px-1 py-0.2 text-[9px] font-mono bg-slate-200 rounded text-slate-600">
                F4
              </kbd>
            </label>

            <div className="relative flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  ref={customerInputRef}
                  id="f4-customer-input"
                  type="text"
                  value={customerSearch || activeCart.customer_name}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setIsCustomerDropdownOpen(true);
                  }}
                  onFocus={() => setIsCustomerDropdownOpen(true)}
                  placeholder="Tìm khách theo Tên / SĐT (F4)..."
                  className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <button
                type="button"
                id="btn-quick-customer-modal"
                onClick={() => setIsQuickCustomerModalOpen(true)}
                className="h-8 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
                title="Thêm nhanh khách hàng mới (+)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {activeCustomer && (
              <div className="mt-1 flex items-center justify-between text-[11px] px-1 font-mono">
                <span className="text-slate-500">
                  Nợ hiện tại: <strong className="text-rose-600">{formatVND(activeCustomer.current_debt)}</strong>
                </span>
                <span className="text-slate-400">
                  Hạn mức: {formatVND(activeCustomer.debt_limit)}
                </span>
              </div>
            )}

            {/* Customer Dropdown */}
            {isCustomerDropdownOpen && (
              <div className="absolute top-14 left-0 right-0 bg-white border border-slate-200 rounded-md shadow-xl z-30 max-h-48 overflow-y-auto">
                {filteredCustomers.map((cust) => (
                  <div
                    key={cust.id}
                    onClick={() => {
                      updateActiveTab({
                        customer_id: cust.id,
                        customer_name: cust.name,
                        customer_phone: cust.phone,
                      });
                      setCustomerSearch('');
                      setIsCustomerDropdownOpen(false);
                    }}
                    className="p-2 text-xs hover:bg-blue-50 cursor-pointer border-b border-slate-100 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-slate-800">{cust.name}</div>
                      <div className="text-[10px] text-slate-400">{cust.phone} • {cust.address}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-mono text-rose-600 font-semibold">
                        Nợ: {formatVND(cust.current_debt)}
                      </div>
                      <span className="text-[9px] px-1 bg-slate-100 rounded text-slate-500">
                        {cust.group === 'contractor' ? 'Thợ kính' : 'Khách lẻ'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pricing & Calculations Breakdown */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2 text-xs">
            {/* Subtotal */}
            <div className="flex items-center justify-between text-slate-600">
              <span>Tổng tiền hàng ({activeCart.items.length} món):</span>
              <span className="font-mono font-semibold text-slate-800">
                {formatVND(calculatedTotals.subtotal)}
              </span>
            </div>

            {/* Discount [F8] */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Percent className="w-3.5 h-3.5 text-blue-600" />
                <span>Giảm giá đơn:</span>
                <kbd className="hidden sm:inline-flex px-1 text-[9px] font-mono bg-slate-100 rounded text-slate-500">F8</kbd>
              </div>
              <div className="flex items-center gap-1 w-36">
                <input
                  ref={discountInputRef}
                  id="f8-discount-input"
                  type="text"
                  value={
                    discountType === 'percent'
                      ? activeCart.discount_percent
                      : activeCart.discount_amount
                      ? new Intl.NumberFormat('vi-VN').format(activeCart.discount_amount)
                      : ''
                  }
                  onChange={(e) => {
                    if (discountType === 'percent') {
                      const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                      updateActiveTab({ discount_percent: val, discount_amount: 0 });
                    } else {
                      handleMoneyInputChange(e, (num) => {
                        updateActiveTab({ discount_amount: num, discount_percent: 0 });
                      });
                    }
                  }}
                  placeholder="0"
                  className="w-full h-7 px-2 text-right font-mono text-xs bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType((prev) => (prev === 'vnd' ? 'percent' : 'vnd'));
                    updateActiveTab({ discount_amount: 0, discount_percent: 0 });
                  }}
                  className="h-7 w-8 shrink-0 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-[10px] font-bold text-slate-700 flex items-center justify-center"
                >
                  {discountType === 'vnd' ? 'đ' : '%'}
                </button>
              </div>
            </div>

            {/* Phụ phí / Vận chuyển [F6] — 2 chế độ đ / % như Giảm giá đơn */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Truck className="w-3.5 h-3.5 text-blue-600" />
                <span>Phụ phí / Vận chuyển:</span>
                <kbd className="hidden sm:inline-flex px-1 text-[9px] font-mono bg-slate-100 rounded text-slate-500">F6</kbd>
              </div>
              <div className="flex items-center gap-1 w-36">
                <input
                  ref={shippingInputRef}
                  id="f6-shipping-input"
                  type="text"
                  value={
                    shippingType === 'percent'
                      ? activeCart.shipping_percent || ''
                      : activeCart.shipping_fee
                      ? new Intl.NumberFormat('vi-VN').format(activeCart.shipping_fee)
                      : ''
                  }
                  onChange={(e) => {
                    if (shippingType === 'percent') {
                      const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                      updateActiveTab({ shipping_percent: val, shipping_type: 'percent', shipping_fee: 0 });
                    } else {
                      handleMoneyInputChange(e, (num) => {
                        updateActiveTab({ shipping_fee: num, shipping_type: 'vnd', shipping_percent: 0 });
                      });
                    }
                  }}
                  placeholder="0"
                  className="w-full h-7 px-2 text-right font-mono text-xs bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  id="btn-shipping-type"
                  onClick={() => {
                    const next = shippingType === 'vnd' ? 'percent' : 'vnd';
                    setShippingType(next);
                    updateActiveTab({ shipping_fee: 0, shipping_percent: 0, shipping_type: next });
                  }}
                  className="h-7 w-8 shrink-0 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-[10px] font-bold text-slate-700 flex items-center justify-center"
                >
                  {shippingType === 'vnd' ? 'đ' : '%'}
                </button>
              </div>
            </div>

            {/* VAT Tax Selector */}
            <div className="flex items-center justify-between text-slate-600">
              <span className="text-[11px] font-medium">Thuế GTGT (VAT):</span>
              <div className="flex items-center gap-1">
                {[0, 8, 10].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => updateActiveTab({ vat_percent: rate })}
                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-colors ${
                      (activeCart.vat_percent ?? 0) === rate
                        ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {rate}%
                  </button>
                ))}
                {calculatedTotals.vat_amount > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-slate-800 ml-1">
                    +{formatVND(calculatedTotals.vat_amount)}
                  </span>
                )}
              </div>
            </div>

            {/* Cash Rounding Floor (NEW-CONF-03 & SRS 2.2) */}
            {activeCart.payment_method === 'cash' && calculatedTotals.cash_rounding > 0 && (
              <div
                id="cash-rounding-display"
                className="flex items-center justify-between text-amber-700 font-semibold bg-amber-50 px-2 py-1 rounded"
              >
                <span className="flex items-center gap-1">
                  <span>Làm tròn tiền mặt (500đ floor):</span>
                </span>
                <span className="font-mono">-{formatVND(calculatedTotals.cash_rounding)}</span>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-900">KHÁCH CẦN TRẢ:</span>
              <span id="payable-total-display" className="font-bold text-base text-rose-600 font-mono">
                {formatVND(calculatedTotals.payable)}
              </span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-600">Phương thức thanh toán:</label>
            <div className="grid grid-cols-4 gap-1">
              <button
                id="payment-method-cash"
                type="button"
                onClick={() => updateActiveTab({ payment_method: 'cash' })}
                className={`py-1.5 px-1 rounded-md text-[11px] font-semibold flex flex-col items-center gap-1 border transition-all ${
                  activeCart.payment_method === 'cash'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Tiền mặt</span>
              </button>

              <button
                id="payment-method-transfer"
                type="button"
                onClick={() => updateActiveTab({ payment_method: 'transfer' })}
                className={`py-1.5 px-1 rounded-md text-[11px] font-semibold flex flex-col items-center gap-1 border transition-all ${
                  activeCart.payment_method === 'transfer'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>VietQR</span>
              </button>

              <button
                id="payment-method-card"
                type="button"
                onClick={() => updateActiveTab({ payment_method: 'card' })}
                className={`py-1.5 px-1 rounded-md text-[11px] font-semibold flex flex-col items-center gap-1 border transition-all ${
                  activeCart.payment_method === 'card'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Quẹt thẻ</span>
              </button>

              <button
                id="payment-method-debt"
                type="button"
                onClick={() => updateActiveTab({ payment_method: 'debt' })}
                className={`py-1.5 px-1 rounded-md text-[11px] font-semibold flex flex-col items-center gap-1 border transition-all ${
                  activeCart.payment_method === 'debt'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Ghi nợ</span>
              </button>
            </div>
          </div>

          {/* VietQR Dynamic Code Preview if transfer selected */}
          {activeCart.payment_method === 'transfer' && (
            <div
              id="vietqr-preview-box"
              className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3 animate-in fade-in-50"
            >
              {isVietqrReady(vietqr) ? (
                <>
                  {/* QR động theo số tiền từ img.vietqr.io — next/image không tối ưu được ảnh ngoài động: giữ <img>. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={buildVietqrUrl(vietqr, calculatedTotals.payable, `MULTIPOS ${activeCart.name}`)}
                    alt="VietQR thanh toán"
                    className="w-24 h-24 bg-white p-1 rounded border border-blue-300 object-contain"
                  />
                  <div className="text-[11px] leading-relaxed">
                    <div className="font-bold text-blue-900">Mã VietQR Động Chuẩn Napas247</div>
                    <div className="text-slate-600">
                      {vietqr.bank} • {vietqr.account} • {vietqr.name}
                    </div>
                    <div className="text-slate-600 font-mono font-semibold">
                      Số tiền: {formatVND(calculatedTotals.payable)}
                    </div>
                    <div className="text-[10px] text-blue-700 font-mono">
                      Nội dung: {vietqrAddInfo(`MULTIPOS ${activeCart.name}`)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-white p-1 rounded border border-blue-300 flex items-center justify-center">
                    <QrCode className="w-14 h-14 text-slate-300" />
                  </div>
                  <div className="text-[11px] leading-relaxed">
                    <div className="font-bold text-amber-800">Chưa cấu hình VietQR</div>
                    <div className="text-slate-600">
                      Vào Cài đặt (Alt+S) → VietQR để nhập ngân hàng & số tài khoản, mã QR thật sẽ hiện ở đây.
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tendered Amount [F9] */}
          {activeCart.payment_method !== 'debt' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <span>Tiền khách đưa:</span>
                <kbd className="hidden sm:inline-flex px-1 text-[9px] font-mono bg-slate-200 rounded text-slate-600">F9</kbd>
              </div>
              <input
                ref={tenderedInputRef}
                id="f9-tendered-input"
                type="text"
                value={
                  activeCart.tendered_amount
                    ? new Intl.NumberFormat('vi-VN').format(activeCart.tendered_amount)
                    : ''
                }
                onChange={(e) => {
                  handleMoneyInputChange(e, (num) => updateActiveTab({ tendered_amount: num }));
                }}
                placeholder="0"
                className="w-full h-9 px-3 text-right font-mono font-bold text-base text-blue-700 bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
              />

              {/* Quick Cash Presets */}
              <div className="flex items-center gap-1 pt-1 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setQuickTender(calculatedTotals.payable)}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-[10px] font-semibold text-slate-700"
                >
                  Đủ tiền
                </button>
                <button
                  type="button"
                  onClick={() => setQuickTender(500000)}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-[10px] font-mono font-medium text-slate-700"
                >
                  500k
                </button>
                <button
                  type="button"
                  onClick={() => setQuickTender(1000000)}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-[10px] font-mono font-medium text-slate-700"
                >
                  1.000k
                </button>
                <button
                  type="button"
                  onClick={() => setQuickTender(2000000)}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-[10px] font-mono font-medium text-slate-700"
                >
                  2.000k
                </button>
                <button
                  type="button"
                  onClick={() => setQuickTender(5000000)}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-[10px] font-mono font-medium text-slate-700"
                >
                  5.000k
                </button>
              </div>

              {/* Change or Remaining Debt display (POS-ERR-01 Fix) */}
              <div className="pt-2 flex items-center justify-between text-xs font-semibold">
                {calculatedTotals.change_amount > 0 ? (
                  <>
                    <span className="text-emerald-700">Tiền thừa trả khách:</span>
                    <span className="font-mono text-emerald-700 text-sm font-bold">
                      {formatVND(calculatedTotals.change_amount)}
                    </span>
                  </>
                ) : calculatedTotals.debt_amount > 0 ? (
                  <>
                    <span className="text-amber-700">Còn thiếu (Ghi nợ):</span>
                    <span className="font-mono text-amber-700 text-sm font-bold">
                      {formatVND(calculatedTotals.debt_amount)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-500">Tiền thừa:</span>
                    <span className="font-mono text-slate-500">0 đ</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Note Input */}
          <div>
            <textarea
              value={activeCart.note}
              onChange={(e) => updateActiveTab({ note: e.target.value })}
              placeholder="Ghi chú đơn hàng (hẹn giao, quy cách phụ)..."
              rows={2}
              className="w-full p-2 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
            />
          </div>
        </div>

        {/* BOTTOM ACTION BUTTONS: [Ctrl + F9: Đặt hàng / Nhận cọc] & [F10: THANH TOÁN] */}
        <div className="pt-3 border-t border-slate-200 space-y-2">
          {(currentShift.status !== 'open' || needLogin) && (
            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 leading-relaxed">
              {needLogin ? (
                <>
                  Chưa đăng nhập thu ngân —{' '}
                  <button onClick={() => setLoginOpen(true)} className="font-bold underline hover:text-amber-700">
                    Đăng nhập
                  </button>{' '}
                  để bán hàng.
                </>
              ) : (
                <>
                  Ca làm việc đã đóng —{' '}
                  <button onClick={() => setShiftModalOpen(true)} className="font-bold underline hover:text-amber-700">
                    Mở ca mới (F12)
                  </button>{' '}
                  để tiếp tục bán.
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {/* Ctrl + F9: Deposit / Pre-order */}
            <button
              id="btn-pos-deposit"
              type="button"
              disabled={isProcessing || activeCart.items.length === 0 || currentShift.status !== 'open' || needLogin}
              onClick={handleDepositOrder}
              className="w-full py-2.5 px-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg shadow-sm flex flex-col items-center justify-center transition-all cursor-pointer"
            >
              <div className="flex items-center gap-1 text-[11px]">
                <span>ĐẶT HÀNG / CỌC</span>
              </div>
              <span className="text-[10px] font-mono text-slate-900 font-semibold">[Ctrl + F9]</span>
            </button>

            {/* Clear Cart */}
            <button
              id="btn-pos-clear-cart"
              type="button"
              onClick={clearActiveCart}
              className="w-full py-2.5 px-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-lg flex items-center justify-center gap-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa giỏ (Esc)</span>
            </button>
          </div>

          {/* F10: Main Checkout Button */}
          <button
            id="btn-pos-checkout"
            type="button"
            disabled={isProcessing || activeCart.items.length === 0 || currentShift.status !== 'open' || needLogin}
            onClick={handleCheckout}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-lg shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>THANH TOÁN (F10)</span>
            <span className="text-xs font-mono font-normal opacity-90">
              — {formatVND(calculatedTotals.payable)}
            </span>
          </button>
        </div>
      </>
      )}
      </div>

      <MobilePOSDock
        isImportFlow={isImportFlow}
        itemCount={isImportFlow ? impLines.length : activeCart.items.length}
        total={isImportFlow ? impTotal : calculatedTotals.payable}
        disabled={
          isImportFlow
            ? isProcessing || impLines.length === 0 || currentShift.status !== 'open' || needLogin
            : isProcessing || activeCart.items.length === 0 || currentShift.status !== 'open' || needLogin
        }
        onOpenMenu={() => setFlyoutMenuOpen(true)}
        onOpenCart={() => {
          if (isImportFlow) {
            const target = document.getElementById('import-table-container');
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
          setIsMobileCartOpen(true);
        }}
        onPrimaryAction={isImportFlow ? handleImportCommit : handleCheckout}
      />

      <MobileCartSheet
        open={isMobileCartOpen && !isImportFlow}
        onClose={() => setIsMobileCartOpen(false)}
        items={activeCart.items}
        payable={calculatedTotals.payable}
        canCheckout={!isProcessing && activeCart.items.length > 0 && currentShift.status === 'open' && !needLogin}
        checkoutLabel={isProcessing ? 'Đang xử lý…' : needLogin ? 'Cần đăng nhập' : 'Thanh toán'}
        onQuantityChange={(itemId, quantity) => updateCartItem(itemId, { quantity })}
        onRemove={removeCartItem}
        onEditDimension={(item) => setDimensionModalItem({ item })}
        onClear={clearActiveCart}
        onCheckout={handleCheckout}
      />

      {/* Quick Customer Creation Modal */}
      <POSQuickCustomerModal open={isQuickCustomerModalOpen} onClose={() => setIsQuickCustomerModalOpen(false)} />

      {/* Quick Supplier Creation Modal */}
      {isQuickSupplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="font-bold text-sm flex items-center gap-2">
                <Truck className="w-4 h-4 text-emerald-400" />
                Thêm Nhà Cung Cấp Mới
              </span>
              <button
                onClick={() => { setIsQuickSupplierModalOpen(false); setSupName(''); setSupPhone(''); setSupAddress(''); setSupTaxCode(''); }}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSupplier} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Tên Nhà Cung Cấp / Công Ty <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  placeholder="VD: Công ty TNHH Nhôm Kính Xingfa Hải Phòng"
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    placeholder="0912..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Mã số thuế</label>
                  <input
                    type="text"
                    value={supTaxCode}
                    onChange={(e) => setSupTaxCode(e.target.value)}
                    placeholder="010..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Địa chỉ kho / trụ sở</label>
                <input
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  placeholder="Khu công nghiệp, Đường..."
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsQuickSupplierModalOpen(false); setSupName(''); setSupPhone(''); setSupAddress(''); setSupTaxCode(''); }}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={supCreating}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded shadow-xs"
                >
                  {supCreating ? 'Đang lưu…' : 'Lưu nhà cung cấp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
