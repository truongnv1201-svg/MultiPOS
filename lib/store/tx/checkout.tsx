// P3-tx/checkout: checkout đơn POS (tách verbatim từ tx/orders.tsx block checkoutActiveOrder).
// Nhận slice giỏ + ca/quỹ + setters đơn qua params; catalog/auth/network/commerce tự gọi.
'use client';

import { useCallback, useMemo } from 'react';
import { useAuth } from '../auth';
import { useCommerce } from '../commerce';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type { Order, CashbookEntry, Shift, PaymentItem } from '../../types';
import type { CartTab } from '../types';
import type { TxOrdersDeps } from './orders-types';
import { toRpcItems } from '../rpc';
import { db, generateOrderCode } from '../../db';
import { resolvePaidAmount } from '../../pricing';
import { vietnamizeError } from '../../error-vi';
import { notify } from '@/components/common/Toast';

export interface TxCheckoutDeps {
  activeCart: CartTab;
  calculatedTotals: TxOrdersDeps['calculatedTotals'];
  clearActiveCart: () => void;
  setReceiptModalOrder: (order: Order | null) => void;
  setShiftModalOpen: (open: boolean) => void;
  currentShift: Shift;
  setCurrentShift: React.Dispatch<React.SetStateAction<Shift>>;
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
}

export interface TxCheckout {
  checkoutActiveOrder: (isDeposit?: boolean) => Promise<Order | null>;
}

export function useTxCheckout({
  activeCart,
  calculatedTotals,
  clearActiveCart,
  setReceiptModalOrder,
  setShiftModalOpen,
  currentShift,
  setCurrentShift,
  setCashbook,
  setOrders,
  setPendingQueue,
}: TxCheckoutDeps): TxCheckout {
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { shop } = useCommerce();
  const { products, setProducts, setCustomers, customerMap, syncCustomers } = useCatalog();
  const { isOnline } = useNetwork();

  // Thu ngân hiện tại gắn với tài khoản đăng nhập (fix kết ca ẩn danh)
  const cashierName = useMemo(
    () => profile?.full_name || user?.email || 'Chưa đăng nhập',
    [profile, user]
  );

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
      setCashbook,
      setCurrentShift,
      setReceiptModalOrder,
      setShiftModalOpen,
      setOrders,
      setPendingQueue,
    ]
  );

  return {
    checkoutActiveOrder,
  };
}
