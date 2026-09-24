// P3-tx/order-returns: hủy đơn + trả hàng (tách verbatim từ tx/orders.tsx).
// Nhận orders/setOrders/setPendingQueue + ca/quỹ + resolveServerOrderId qua params; catalog/auth/network tự gọi.
'use client';

import { useCallback } from 'react';
import { useAuth } from '../auth';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type { Order, CashbookEntry, Shift } from '../../types';
import type { ReturnResult, RestockLine, ReturnSkipped } from '../types';
import { db, generateOrderCode } from '../../db';
import { vietnamizeError } from '../../error-vi';
import { notify } from '@/components/common/Toast';

export interface TxOrderReturnsDeps {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
  currentShift: Shift;
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  resolveServerOrderId: (order: Order) => Promise<string | null>;
}

export interface TxOrderReturns {
  cancelOrder: (orderId: string) => Promise<boolean>;
  returnOrder: (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]) => Promise<ReturnResult>;
}

export function useTxOrderReturns({
  orders,
  setOrders,
  setPendingQueue,
  currentShift,
  setCashbook,
  resolveServerOrderId,
}: TxOrderReturnsDeps): TxOrderReturns {
  const { supa, user, setLoginOpen } = useAuth();
  const { products, setProducts, customers, setCustomers } = useCatalog();
  const { isOnline } = useNetwork();

  // Cancel Order & Reverse (FIN-ERR-05)
  // 0024: đơn đã lên server + online -> commit qua RPC cancel_order (server hoàn kho/đảo nợ/
  // hoàn quỹ; local mirror lại cho Dexie/UI khớp). Đơn server mà offline -> CHẶN để khỏi lệch
  // truth. Đơn chưa lên server -> xử lý local + gỡ khỏi hàng đợi pending.
  const cancelOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi hủy đơn!', 'error');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Không được hủy/trả đơn sau khi kết ca.', 'error');
        return false;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.status === 'cancelled' || order.status === 'returned') return false;

      const serverId = await resolveServerOrderId(order);
      if (serverId && !isOnline) {
        notify('Đơn này đã đồng bộ server nhưng đang ngoại tuyến — không thể hủy lúc này để tránh lệch kho/nợ. Hãy online rồi thử lại.', 'error');
        return false;
      }
      if (serverId && supa) {
        try {
          const { error } = await supa.rpc('cancel_order', { p_order_id: serverId });
          if (error) throw new Error(error.message);
        } catch (err: any) {
          notify(`Hủy đơn server thất bại — giữ nguyên đơn để thử lại: ${vietnamizeError(err)}`, 'error');
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
    [orders, setOrders, setPendingQueue, products, supa, user, currentShift, isOnline, resolveServerOrderId, setLoginOpen, setCustomers, setProducts, setCashbook]
  );

  // Return Order with Debt Clamping (FIN-ERR-03)
  const returnOrder = useCallback(
    async (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]): Promise<ReturnResult> => {
      const fail: ReturnResult = { ok: false, restocked: [], skipped: [] };
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi trả hàng!', 'error');
        setLoginOpen(true);
        return fail;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Không được hủy/trả đơn sau khi kết ca.', 'error');
        return fail;
      }
      const order = orders.find((o) => o.id === orderId);
      if (!order) return fail;
      // 0026: chỉ đơn hiệu lực mới trả được (chặn trả lặp cả khi gọi trực tiếp hàm)
      if (order.status !== 'completed' && order.status !== 'deposit_order') {
        notify('Đơn này đã hủy/trả rồi — không xử lý lặp.', 'error');
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
        notify('Đơn này đã đồng bộ server nhưng đang ngoại tuyến — không thể trả hàng lúc này để tránh lệch nợ. Hãy online rồi thử lại.', 'error');
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
          notify(`Trả hàng server thất bại — giữ nguyên đơn để thử lại: ${vietnamizeError(err)}`, 'error');
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
    [orders, setOrders, setPendingQueue, products, customers, supa, user, currentShift, isOnline, resolveServerOrderId, setLoginOpen, setCustomers, setProducts, setCashbook]
  );

  return {
    cancelOrder,
    returnOrder,
  };
}
