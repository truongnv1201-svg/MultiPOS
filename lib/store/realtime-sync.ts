// lib/store/realtime-sync.ts
// Quản lý kết nối Supabase Realtime (WebSocket) cho toàn hệ thống:
// Lắng nghe biến động orders, cashbook_entries, products, customers theo thời gian thực.
'use client';

import { useState, useEffect } from 'react';
import type React from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Order, CashbookEntry, Product, Customer, OrderStatus } from '../types';
import { db } from '../db';

export type RealtimeStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

export interface RealtimeSyncProps {
  supa: SupabaseClient | null;
  isOnline: boolean;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
}

export function mapServerOrder(row: any): Order {
  return {
    id: row.id,
    server_id: row.id,
    client_uuid: row.client_uuid ?? undefined,
    order_code: row.order_code,
    customer_id: row.customer_id ?? undefined,
    customer_name: row.customer_name || 'Khách Lẻ',
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
    change_amount: 0,
    payments: [],
    status: row.status as OrderStatus,
    note: row.note ?? undefined,
    created_at: row.created_at,
    cashier_name: 'Thu ngân',
    branch_name: 'Chi nhánh chính',
    items: (row.order_items || []).map((it: any) => ({
      id: it.id,
      product_id: it.product_id,
      sku: it.sku,
      name: it.name,
      product_type: it.item_type || 'goods',
      unit: it.unit || 'cái',
      unit_price: Number(it.unit_price || 0),
      quantity: Number(it.quantity || 0),
      discount_amount: Number(it.discount_amount || 0),
      processing_fee: Number(it.processing_fee || 0),
      subtotal: Number(it.subtotal || 0),
      dimension_details: it.dimension_details || undefined,
      waste_factor: Number(it.waste_factor || 0),
      material_consumed: Number(it.material_consumed || 0),
      returned_indexes: it.returned_indexes || [],
    })),
  };
}

export function mapServerCashbook(row: any): CashbookEntry {
  return {
    id: row.id,
    code: row.code,
    type: row.type as 'receipt' | 'expense',
    fund_type: row.fund_type as 'cash' | 'bank',
    category: row.category,
    amount: Number(row.amount || 0),
    reference_order_code: row.reference_order_code ?? undefined,
    partner_name: row.partner_name ?? undefined,
    note: row.note ?? undefined,
    created_at: row.created_at,
  };
}

export function useRealtimeSync({
  supa,
  isOnline,
  setOrders,
  setCashbook,
  setProducts,
  setCustomers,
}: RealtimeSyncProps) {
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');

  useEffect(() => {
    if (!supa || !isOnline) {
      Promise.resolve().then(() => setRealtimeStatus('disconnected'));
      return;
    }

    Promise.resolve().then(() => setRealtimeStatus('connecting'));

    const channel = supa
      .channel('public:realtime-reports')
      // 1. Lắng nghe thay đổi orders
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        async (payload) => {
          try {
            // Fetch chi tiết kèm items để hiển thị đầy đủ
            const { data } = await supa
              .from('orders')
              .select('*, order_items(*)')
              .eq('id', payload.new.id)
              .maybeSingle();

            if (data) {
              const fullOrder = mapServerOrder(data);
              setOrders((prev) => [
                fullOrder,
                ...prev.filter(
                  (o) =>
                    o.id !== fullOrder.id &&
                    o.server_id !== fullOrder.id &&
                    o.order_code !== fullOrder.order_code
                ),
              ]);
              db.orders.put(fullOrder).catch(() => {});
            }
          } catch (err) {
            console.warn('[realtime] Lỗi xử lý INSERT order:', err);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const row = payload.new;
          setOrders((prev) =>
            prev.map((o) => {
              if (
                o.id === row.id ||
                o.server_id === row.id ||
                o.order_code === row.order_code
              ) {
                const updated: Order = {
                  ...o,
                  server_id: row.id,
                  status: row.status as OrderStatus,
                  paid_amount: Number(row.paid_amount || 0),
                  debt_amount: Number(row.debt_amount || 0),
                  total_amount: Number(row.total_amount || 0),
                  subtotal: Number(row.subtotal || 0),
                  discount_amount: Number(row.discount_amount || 0),
                  shipping_fee: Number(row.shipping_fee || 0),
                  vat_amount: Number(row.vat_amount || 0),
                  vat_percent: Number(row.vat_percent || 0),
                  note: row.note ?? o.note,
                };
                db.orders.put(updated).catch(() => {});
                return updated;
              }
              return o;
            })
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'orders' },
        (payload) => {
          const oldId = payload.old?.id;
          if (oldId) {
            setOrders((prev) =>
              prev.filter((o) => o.id !== oldId && o.server_id !== oldId)
            );
            db.orders.delete(oldId).catch(() => {});
          }
        }
      )
      // 2. Lắng nghe thay đổi cashbook_entries
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cashbook_entries' },
        (payload) => {
          const entry = mapServerCashbook(payload.new);
          setCashbook((prev) => [
            entry,
            ...prev.filter((c) => c.id !== entry.id && c.code !== entry.code),
          ]);
          db.cashbook.put(entry).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cashbook_entries' },
        (payload) => {
          const entry = mapServerCashbook(payload.new);
          setCashbook((prev) =>
            prev.map((c) => (c.id === entry.id || c.code === entry.code ? entry : c))
          );
          db.cashbook.put(entry).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'cashbook_entries' },
        (payload) => {
          const oldId = payload.old?.id;
          if (oldId) {
            setCashbook((prev) => prev.filter((c) => c.id !== oldId));
            db.cashbook.delete(oldId).catch(() => {});
          }
        }
      )
      // 3. Lắng nghe thay đổi tồn kho & giá sản phẩm
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'products' },
        (payload) => {
          const row = payload.new;
          setProducts((prev) =>
            prev.map((p) => {
              if (p.id === row.id || p.sku === row.sku) {
                const updated: Product = {
                  ...p,
                  stock_quantity: Number(row.stock_quantity ?? p.stock_quantity),
                  avg_cost: Number(row.avg_cost ?? p.avg_cost),
                  retail_price: Number(row.retail_price ?? p.retail_price),
                  trade_price:
                    row.trade_price != null ? Number(row.trade_price) : p.trade_price,
                  import_price: Number(row.import_price ?? p.import_price),
                };
                db.products.put(updated).catch(() => {});
                return updated;
              }
              return p;
            })
          );
        }
      )
      // 4. Lắng nghe biến động công nợ khách hàng
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'customers' },
        (payload) => {
          const row = payload.new;
          setCustomers((prev) =>
            prev.map((c) => {
              if (c.id === row.id || (c.phone && c.phone === row.phone)) {
                const updated: Customer = {
                  ...c,
                  current_debt: Number(row.current_debt ?? c.current_debt),
                  debt_limit: Number(row.debt_limit ?? c.debt_limit),
                };
                db.customers.put(updated).catch(() => {});
                return updated;
              }
              return c;
            })
          );
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('error');
        } else if (status === 'CLOSED') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      supa.removeChannel(channel).catch(() => {});
      Promise.resolve().then(() => setRealtimeStatus('disconnected'));
    };
  }, [supa, isOnline, setOrders, setCashbook, setProducts, setCustomers]);

  return { realtimeStatus };
}
