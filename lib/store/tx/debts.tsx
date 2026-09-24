// P3-tx/debts: công nợ KH/NCC + hàng đợi pendingOps (tách verbatim từ transactions.tsx).
'use client';

import { useCallback } from 'react';
import { useAuth } from '../auth';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type { CashbookEntry, Shift } from '../../types';
import { db, generateOrderCode } from '../../db';
import type { PendingOp } from '../../db';
import { asUuidOrNull, enqueueOp } from './constants';
import { vietnamizeError } from '../../error-vi';
import { notify } from '@/components/common/Toast';

export interface TxDebtsDeps {
  currentShift: Shift;
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  setCurrentShift: React.Dispatch<React.SetStateAction<Shift>>;
}

export interface TxDebts {
  collectDebt: (customerId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  syncDebtsFromServer: () => Promise<{ updated: number; skipped: number }>;
  paySupplierDebt: (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string) => Promise<boolean>;
  syncPendingOps: () => Promise<{ synced: number; failed: number }>;
}

export function useTxDebts({ currentShift, setCashbook, setCurrentShift }: TxDebtsDeps): TxDebts {
  const { supa, user } = useAuth();
  const { profile, setLoginOpen } = useAuth();
  const { suppliers, setSuppliers, customers, setCustomers, customerMap, refreshCatalog } = useCatalog();
  const { isOnline } = useNetwork();

  // Collect Customer Debt (FIN-ERR-02)
  const collectDebt = useCallback(
    async (
      customerId: string,
      amount: number,
      paymentMethod: 'cash' | 'transfer',
      note: string
    ): Promise<boolean> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi thu nợ!', 'error');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Không được thu nợ sau khi kết ca. Vui lòng mở ca mới (F12).', 'error');
        return false;
      }
      const customer = customers.find((c) => c.id === customerId);
      if (!customer || amount <= 0) return false;

      // 0024: KH đã link server + online -> RPC collect_debt (server clamp theo nợ thật,
      // local mirror theo số server trả về + refresh truth). KH server mà offline -> CHẶN.
      const serverCustId = customerMap[customerId] ?? null;
      if (serverCustId && !isOnline) {
        notify('Khách hàng đã đồng bộ server nhưng đang ngoại tuyến — không thể thu nợ lúc này để tránh lệch công nợ. Hãy online rồi thử lại.', 'error');
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
          notify(`Thu nợ server thất bại — giữ nguyên để thử lại: ${vietnamizeError(err)}`, 'error');
          return false;
        }
      }

      const actualCollect = serverCollected ?? Math.min(amount, customer.current_debt);
      if (actualCollect <= 0) {
        notify('Không còn nợ phải thu (server báo KH đã hết nợ).', 'info');
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
    [customers, customerMap, isOnline, supa, user, currentShift, setLoginOpen, setCustomers, setCashbook, setCurrentShift]
  );

  // Đồng bộ nợ KH từ server (0025+1): server là truth công nợ — số local có thể cũ khi thu nợ
  // ở máy khác, sửa tay trên Dashboard, hoặc sync gián đoạn. Kéo batch theo uuid đã map,
  // ghi đè current_debt (+debt_limit) local + Dexie. KH chưa link (khách lẻ, máy khác tạo)
  // được bỏ qua — đếm vào skipped để UI báo rõ.
  const syncDebtsFromServer = useCallback(async (): Promise<{ updated: number; skipped: number }> => {
    if (!supa || !user) {
      notify('Vui lòng đăng nhập trước khi đồng bộ công nợ!', 'error');
      setLoginOpen(true);
      return { updated: 0, skipped: 0 };
    }
    if (!isOnline) {
      notify('Đang ngoại tuyến — không thể đồng bộ công nợ. Hãy online rồi thử lại.', 'error');
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
      notify(`Đồng bộ công nợ thất bại: ${vietnamizeError(err)}`, 'error');
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
          // Mirror truth nợ NCC sau khi server ghi phiếu nhập (như op supplier_payment):
          // server có thể clamp/tự tạo NCC theo tên -> tránh mirror local lệch tới lần
          // refreshCatalog sau. NCC chưa có ở máy này -> kéo catalog về luôn.
          try {
            const matched =
              suppliers.find((s) => s.id === p.supplierId) ||
              suppliers.find((s) => s.name.toLowerCase() === p.supplierName.toLowerCase());
            const sid = matched ? asUuidOrNull(matched.id) : null;
            if (sid && matched) {
              const { data: srow } = await supa
                .from('suppliers')
                .select('current_debt')
                .eq('id', sid)
                .maybeSingle();
              const truth = Number((srow as { current_debt?: unknown } | null)?.current_debt);
              if (Number.isFinite(truth)) {
                setSuppliers((prev) =>
                  prev.map((s) => (s.id === matched.id ? { ...s, current_debt: truth } : s))
                );
                await db.suppliers.update(matched.id, { current_debt: truth });
              }
            } else {
              void refreshCatalog();
            }
          } catch {
            /* giữ số mirror hiện có */
          }
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
  }, [supa, user, isOnline, suppliers, setSuppliers, setCashbook, refreshCatalog]);

  // Master Data Add/Update hàng hóa/KH/NCC sống ở CatalogProvider (useCatalog) —
  // ở đây chỉ còn nghiệp vụ chi trả NCC (đụng sổ quỹ -> thuộc tầng Transactions).
  const paySupplierDebt = useCallback(
    async (supplierId: string, amount: number, paymentMethod: 'cash' | 'transfer', note: string): Promise<boolean> => {
      // P2: thu ngân/worker không được chi trả NCC
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        notify('Chỉ Admin/Quản lý được chi trả nợ NCC!', 'error');
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
    [suppliers, supa, profile, setSuppliers, setCashbook, syncPendingOps]
  );

  return { collectDebt, syncDebtsFromServer, paySupplierDebt, syncPendingOps };
}
