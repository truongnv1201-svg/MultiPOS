// P3-tx/orders-sync: state đơn hàng + pending queue + đồng bộ server (tách verbatim từ tx/orders.tsx).
// Sở hữu orders/setOrders, pendingQueue/setPendingQueue + refreshServerOrders/syncPendingOrders/resolveServerOrderId.
'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type { Order, OrderItem, ProductType, CashbookEntry } from '../../types';
import { toRpcItems } from '../rpc';
import { stableNext } from '../stable';
import { db } from '../../db';
import { SERVER_ORDERS_WINDOW_DAYS, SERVER_ORDERS_PAGE_SIZE, SERVER_ORDERS_MAX_PAGES, SERVER_ITEMS_BATCH_SIZE } from './constants';

export interface TxOrdersSyncDeps {
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
}

export interface TxOrdersSync {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  pendingQueue: Order[];
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
  refreshServerOrders: () => Promise<boolean>;
  syncPendingOrders: () => Promise<void>;
  resolveServerOrderId: (order: Order) => Promise<string | null>;
}

export function useTxOrdersSync({ setCashbook }: TxOrdersSyncDeps): TxOrdersSync {
  const { supa, user, profile } = useAuth();
  const { customerMap, refreshCatalog } = useCatalog();
  const { isOnline } = useNetwork();
  const [orders, setOrders] = useState<Order[]>([]);

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
        return stableNext(previous, [...pendingLocal, ...mapped]);
      });
      await db.orders.bulkPut(mapped);
      return true;
    } catch (error) {
      console.warn('Server orders refresh failed:', error);
      return false;
    }
  }, [supa, user, isOnline, profile]);

  const [pendingQueue, setPendingQueue] = useState<Order[]>([]);

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
  }, [isOnline, pendingQueue, supa, customerMap, refreshCatalog, setCashbook]);

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

  return {
    orders,
    setOrders,
    pendingQueue,
    setPendingQueue,
    refreshServerOrders,
    syncPendingOrders,
    resolveServerOrderId,
  };
}
