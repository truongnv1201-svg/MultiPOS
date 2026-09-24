// P3-tx/shift-stock: ca + thẻ kho + sổ quỹ + nhập kho (tách verbatim từ transactions.tsx).
// Đọc pendingQueue + gọi syncPendingOps qua ref (do 2 slice này sống ở debts/orders,
// tạo sau hook này trong composer) để tránh phụ thuộc vòng tròn lúc khởi tạo.
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type { CashbookEntry, Order, PurchaseOrder, Shift, StockMovement } from '../../types';
import { db, generateOrderCode } from '../../db';
import { enqueueOp, EMPTY_SHIFT } from './constants';
import { stableNext } from '../stable';
import { vietnamizeError } from '../../error-vi';
import { notify } from '@/components/common/Toast';

export interface TxShiftStockDeps {
  syncPendingOpsRef: { current: () => Promise<{ synced: number; failed: number }> };
  pendingQueueRef: { current: Order[] };
}

export interface TxShiftStock {
  cashbook: CashbookEntry[];
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  currentShift: Shift;
  setCurrentShift: React.Dispatch<React.SetStateAction<Shift>>;
  stockMovements: StockMovement[];
  setStockMovements: React.Dispatch<React.SetStateAction<StockMovement[]>>;
  refreshServerStockMovements: () => Promise<boolean>;
  refreshServerCashbook: () => Promise<boolean>;
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

export function useTxShiftStock({ syncPendingOpsRef, pendingQueueRef }: TxShiftStockDeps): TxShiftStock {
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { products, setProducts, suppliers, setSuppliers } = useCatalog();
  const { isOnline } = useNetwork();
  const [cashbook, setCashbook] = useState<CashbookEntry[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift>(EMPTY_SHIFT);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  // Thu ngân hiện tại gắn với tài khoản đăng nhập (fix kết ca ẩn danh)
  const cashierName = profile?.full_name || user?.email || 'Chưa đăng nhập';

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
      setStockMovements((prev) => stableNext(prev, mapped));
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
      setCashbook((prev) => stableNext(prev, next));
      await db.cashbook.clear().catch(() => {});
      await db.cashbook.bulkAdd(next).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Cashbook pull failed (giữ local):', err);
      return false;
    }
  }, [supa, user, isOnline]);

  const closeShift = useCallback(
    async (countedCash: number): Promise<boolean> => {
      // Fix thu ngân: bắt buộc đăng nhập + ca đang mở mới được kết ca.
      if (supa && !user) {
        notify('Vui lòng đăng nhập thu ngân trước khi kết ca!', 'error');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        notify('Không có ca đang mở! Ca này đã được kết trước đó.', 'error');
        return false;
      }
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        notify('Số tiền kiểm đếm không hợp lệ!', 'error');
        return false;
      }
      // Gắn ca với người mở: chỉ chủ ca hoặc Admin/Quản lý được kết ca hộ.
      // (Bỏ qua ở chế độ local-only vì không có tài khoản.)
      if (supa && user) {
        const isOwner = currentShift.cashier_name === cashierName;
        const canOverride = profile?.role === 'admin' || profile?.role === 'manager';
        if (!isOwner && !canOverride) {
          notify(
            `Ca này do "${currentShift.cashier_name}" mở — bạn (${cashierName}) không thể kết ca hộ để khỏi lẫn trách nhiệm két tiền. Nhờ đúng người hoặc Admin/Quản lý kết ca.`
          , 'error');
          return false;
        }
      }
      // Invariant 4 & OFF-ERR-01 Check:
      if (!isOnline || pendingQueueRef.current.length > 0) {
        notify(
          'LỖI OFF-ERR-01: Không thể đóng ca làm việc khi thiết bị đang Ngoại tuyến (Offline) hoặc còn đơn hàng chờ đồng bộ!'
        , 'error');
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
          notify(`Kết ca server thất bại — giữ nguyên ca để thử lại: ${vietnamizeError(err)}`, 'error');
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
    [isOnline, currentShift, supa, user, cashierName, profile, setLoginOpen, pendingQueueRef]
  );

  const openNewShift = useCallback(
    async (startingCash: number) => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi mở ca!', 'error');
        setLoginOpen(true);
        return;
      }
      if (currentShift.status === 'open') {
        notify('Ca hiện tại vẫn đang mở! Hãy kết ca (F12) trước khi mở ca mới.', 'error');
        return;
      }
      if (!Number.isFinite(startingCash) || startingCash < 0) {
        notify('Tiền đầu ca không hợp lệ!', 'error');
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
          notify(`Mở ca server thất bại — giữ nguyên để thử lại: ${vietnamizeError(err)}`, 'error');
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
      setCurrentShift((prev) => stableNext(prev, serverShift));
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
        notify('Vui lòng đăng nhập trước khi lập phiếu thu/chi!', 'error');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Không được lập phiếu thu/chi sau khi kết ca.', 'error');
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
      void syncPendingOpsRef.current();
      return true;
    },
    [supa, user, currentShift, setLoginOpen, syncPendingOpsRef]
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
        notify('Chỉ Admin/Quản lý được nhập kho!', 'error');
        return;
      }
      // P2-3: chặn nhập kho khi ca đóng (trước đây chỉ disable nút ở POS, gọi trực tiếp vẫn lọt).
      if (currentShift.status !== 'open') {
        notify('Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới (F12) trước khi nhập kho.', 'error');
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
      void syncPendingOpsRef.current();
    },
    [products, supa, profile, currentShift, setProducts, syncPendingOpsRef]
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
        notify('Chỉ Admin/Quản lý được nhập kho!', 'error');
        return false;
      }
      // P2-3: chặn nhập kho khi ca đóng (trước đây chỉ disable nút ở POS, gọi trực tiếp vẫn lọt).
      if (currentShift.status !== 'open') {
        notify('Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới (F12) trước khi nhập kho.', 'error');
        return false;
      }
      const clean = lines.filter((l) => {
        const p = products.find((x) => x.id === l.productId);
        return p && l.quantity > 0 && l.importPrice > 0;
      });
      if (clean.length === 0) {
        notify('Phiếu nhập chưa có dòng hàng hợp lệ (chọn hàng, SL và đơn giá > 0)!', 'error');
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
      void syncPendingOpsRef.current();
      return true;
    },
    // enqueueOp là hàm module-scope (constants) nên không đưa vào deps (tránh warning exhaustive-deps).
    [products, suppliers, supa, profile, currentShift, setProducts, setSuppliers, setStockMovements, setCashbook, syncPendingOpsRef]
  );

  return {
    cashbook,
    setCashbook,
    currentShift,
    setCurrentShift,
    stockMovements,
    setStockMovements,
    refreshServerStockMovements,
    refreshServerCashbook,
    closeShift,
    openNewShift,
    refreshShiftFromServer,
    addCashbookEntry,
    importStock,
    importStockBatch,
  };
}
