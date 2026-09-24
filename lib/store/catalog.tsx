// P3-phần 2 (tiếp): slice Catalog — master data hàng hóa/KH/NCC + đồng bộ server.
// Sở hữu state + setter + CRUD đơn giản; tầng Transactions (StoreInner) consume để đọc/ghi
// khi checkout/hủy/nhập kho. Phụ thuộc duy nhất: AuthSlice (supa/profile) cho RBAC + sync.
'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from './auth';
import { useNetwork } from './network';
import type { Product, Customer, Supplier } from '../types';
import { db, generateMasterCode, type PendingMasterData } from '../db';
import { stableNext } from './stable';
import { notify } from '@/components/common/Toast';

export interface CatalogSlice {
  products: Product[];
  suppliers: Supplier[];
  customers: Customer[];
  customerMap: Record<string, string>;
  catalogSource: 'local' | 'server';
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  refreshCatalog: () => Promise<boolean>;
  syncMasterData: () => Promise<{ synced: number; failed: number }>;
  syncCustomers: () => Promise<Record<string, string>>;
  addProduct: (data: Omit<Product, 'id' | 'sku'> & { sku?: string }) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  addCustomer: (data: Omit<Customer, 'id' | 'code' | 'created_at'> & { created_at?: string }) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  addSupplier: (data: Omit<Supplier, 'id' | 'code'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
}

// P1 Sửa/Xóa: id uuid server (= đã đồng bộ), id local còn lại (= chưa lên server).
const IS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CatalogContext = createContext<CatalogSlice | null>(null);

// 0009: map id KH local -> uuid server, persist localStorage (sống qua reload)
const CUSTOMER_MAP_KEY = 'multipos_customer_map_v1';

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { supa, user, profile } = useAuth();
  const { isOnline } = useNetwork();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalogSource, setCatalogSource] = useState<'local' | 'server'>('local');
  const [customerMap, setCustomerMap] = useState<Record<string, string>>(() => {
    try {
      if (typeof window === 'undefined') return {};
      return JSON.parse(localStorage.getItem(CUSTOMER_MAP_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const queueMasterData = useCallback(
    async (
      entity: PendingMasterData['entity'],
      operation: PendingMasterData['operation'],
      localId: string,
      payload: Record<string, unknown>
    ) => {
      const existing = await db.pendingMasterData
        .where('local_id')
        .equals(localId)
        .filter((item) => item.entity === entity && item.operation === 'insert' && item.status !== 'failed')
        .first();
      if (existing && operation === 'update') {
        await db.pendingMasterData.update(existing.id, { payload: { ...existing.payload, ...payload } });
        return;
      }
      await db.pendingMasterData.put({
        id: `${entity}-${operation}-${localId}-${Date.now()}`,
        entity,
        operation,
        local_id: localId,
        payload,
        created_at: new Date().toISOString(),
        attempts: 0,
        status: 'pending',
      });
    },
    []
  );

  const syncMasterData = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!supa || !user || !isOnline) return { synced: 0, failed: 0 };
    const queue = await db.pendingMasterData.orderBy('created_at').toArray();
    let synced = 0;
    let failed = 0;
    const localToServer = new Map<string, string>();
    for (const item of queue) {
      if (item.status === 'failed' && item.attempts >= 5) {
        failed += 1;
        continue;
      }
      try {
        const serverId = localToServer.get(item.local_id) || item.local_id;
        let result: { data: any; error: any };
        if (item.operation === 'insert') {
          const payload = item.entity === 'product'
            ? {
                sku: item.payload.sku,
                barcode: item.payload.barcode ?? null,
                name: item.payload.name,
                category: item.payload.category,
                unit: item.payload.unit,
                product_type: item.payload.product_type,
                retail_price: item.payload.retail_price,
                trade_price: item.payload.trade_price ?? null,
                import_price: item.payload.import_price,
                avg_cost: item.payload.avg_cost,
                stock_quantity: item.payload.stock_quantity,
                min_stock: item.payload.min_stock ?? 0,
                waste_factor: item.payload.waste_factor ?? 0,
                default_grinding_price: item.payload.default_grinding_price ?? 0,
              }
            : item.entity === 'customer'
              ? {
                  code: item.payload.code,
                  name: item.payload.name,
                  phone: item.payload.phone ?? null,
                  address: item.payload.address ?? null,
                  customer_group: item.payload.customer_group ?? item.payload.group,
                  debt_limit: item.payload.debt_limit ?? 0,
                  current_debt: item.payload.current_debt ?? 0,
                }
              : {
                  code: item.payload.code,
                  name: item.payload.name,
                  phone: item.payload.phone ?? null,
                  address: item.payload.address ?? null,
                  tax_code: item.payload.tax_code ?? null,
                  current_debt: item.payload.current_debt ?? 0,
                };
          result = await supa.from(item.entity === 'product' ? 'products' : item.entity === 'customer' ? 'customers' : 'suppliers')
            // Bảng được chọn động theo queue entity; payload đã được whitelist ở trên.
            .insert(payload as never)
            .select('*')
            .single();
        } else if (item.operation === 'delete') {
          const table = item.entity === 'product' ? 'products' : item.entity === 'customer' ? 'customers' : 'suppliers';
          const targetId =
            typeof item.payload.server_id === 'string' && item.payload.server_id
              ? item.payload.server_id
              : serverId;
          if (!targetId || !IS_UUID_RE.test(targetId)) {
            // Bản local chưa từng lên server -> không có gì để xóa
            await db.pendingMasterData.delete(item.id);
            synced += 1;
            continue;
          }
          const { error } = await supa.from(table).delete().eq('id', targetId);
          if (error) {
            if (/foreign key|violates|23503/i.test(error.message || ''))
              throw new Error('Bản ghi đã phát sinh giao dịch nên không thể xóa.');
            throw new Error(error.message);
          }
          await db.pendingMasterData.delete(item.id);
          synced += 1;
          continue;
        } else {
          const table = item.entity === 'product' ? 'products' : item.entity === 'customer' ? 'customers' : 'suppliers';
          const payload = { ...item.payload };
          delete payload.id;
          result = await supa.from(table).update(payload).eq('id', serverId).select('*').single();
        }
        if (result.error || !result.data) throw new Error(result.error?.message || 'Server không trả về dữ liệu.');
        const row = result.data;
        if (item.operation === 'insert') localToServer.set(item.local_id, row.id);
        const mappedId = row.id || serverId;
        if (item.entity === 'product') {
          await db.products.delete(item.local_id).catch(() => {});
          await db.products.put({
            ...(item.payload as unknown as Product),
            id: mappedId,
            sku: row.sku,
            avg_cost: Number(row.avg_cost),
            stock_quantity: Number(row.stock_quantity),
          });
          setProducts((prev) => prev.map((p) => (p.id === item.local_id ? { ...p, id: mappedId, sku: row.sku } : p)));
        } else if (item.entity === 'customer') {
          await db.customers.delete(item.local_id).catch(() => {});
          const mapped = { ...(item.payload as unknown as Customer), id: mappedId, code: row.code, created_at: row.created_at };
          await db.customers.put(mapped);
          setCustomers((prev) => prev.map((c) => (c.id === item.local_id ? mapped : c)));
          setCustomerMap((prev) => {
            const next = { ...prev, [item.local_id]: mappedId };
            try {
              localStorage.setItem(CUSTOMER_MAP_KEY, JSON.stringify(next));
            } catch {
              /* best-effort */
            }
            return next;
          });
        } else {
          await db.suppliers.delete(item.local_id).catch(() => {});
          await db.suppliers.put({ ...(item.payload as unknown as Supplier), id: mappedId, code: row.code });
          setSuppliers((prev) => prev.map((s) => (s.id === item.local_id ? { ...s, id: mappedId, code: row.code } : s)));
        }
        await db.pendingMasterData.delete(item.id);
        synced += 1;
      } catch (error) {
        failed += 1;
        await db.pendingMasterData.update(item.id, {
          status: 'failed',
          attempts: item.attempts + 1,
          last_error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { synced, failed };
  }, [supa, user, isOnline]);

  // P3: tải catalog từ server. Đã login (authenticated) -> bảng products đủ cột;
  // chưa login (anon, RLS 0051 chặn giá vốn) -> view catalog_public an toàn.
  // Thất bại -> giữ local (offline-first).
  const refreshCatalog = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const [productsPrimary, customersResult, suppliersResult, comboResult] = await Promise.all([
        supa.from('products').select('*').order('sku'),
        supa.from('customers').select('*').order('code'),
        supa.from('suppliers').select('*').order('code'),
        supa.from('combo_items').select('combo_product_id,child_product_id,child_sku,quantity'),
      ]);
      let productsResult = productsPrimary;
      if (productsResult.error) {
        // Anon bị chặn bảng gốc (0051) -> đọc view public không giá vốn
        const fallback = await supa.from('catalog_public').select('*').order('sku');
        if (!fallback.error && fallback.data) productsResult = fallback as typeof productsPrimary;
      }
      const { data, error } = productsResult;
      if (error || !data || customersResult.error || suppliersResult.error || comboResult.error) return false;
      const comboItemsByProduct = new Map<string, { product_id: string; sku: string; name: string; quantity: number }[]>();
      for (const row of (comboResult.data || []) as any[]) {
        const child = (data as any[]).find((product) => product.id === row.child_product_id);
        if (!child) continue;
        const items = comboItemsByProduct.get(row.combo_product_id) || [];
        items.push({
          product_id: row.child_product_id,
          sku: row.child_sku || child.sku,
          name: child.name,
          quantity: Number(row.quantity) || 0,
        });
        comboItemsByProduct.set(row.combo_product_id, items);
      }
      const mapped: Product[] = (data as any[]).map((row) => ({
        id: row.id,
        sku: row.sku,
        barcode: row.barcode ?? undefined,
        name: row.name,
        category: row.category,
        unit: row.unit,
        product_type: row.product_type,
        retail_price: Number(row.retail_price ?? 0),
        trade_price: row.trade_price != null ? Number(row.trade_price) : undefined,
        // View catalog_public (anon, 0051) không có cột giá vốn -> 0, chỉ dùng hiển thị;
        // số liệu vốn/tồn chuẩn vẫn do authenticated tải từ bảng gốc.
        import_price: Number(row.import_price ?? 0),
        avg_cost: Number(row.avg_cost ?? row.import_price ?? 0),
        stock_quantity: Number(row.stock_quantity ?? 0),
        min_stock: row.min_stock != null ? Number(row.min_stock) : undefined,
        waste_factor: row.waste_factor != null ? Number(row.waste_factor) : undefined,
        default_grinding_price: row.default_grinding_price != null ? Number(row.default_grinding_price) : undefined,
        combo_items: comboItemsByProduct.get(row.id),
      }));
      setProducts(mapped);
      const mappedCustomers: Customer[] = (customersResult.data as any[]).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        phone: row.phone ?? '',
        address: row.address ?? undefined,
        group: row.customer_group,
        current_debt: Number(row.current_debt) || 0,
        debt_limit: Number(row.debt_limit) || 0,
        created_at: row.created_at,
      }));
      const mappedSuppliers: Supplier[] = (suppliersResult.data as any[]).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        phone: row.phone ?? '',
        address: row.address ?? undefined,
        tax_code: row.tax_code ?? undefined,
        current_debt: Number(row.current_debt) || 0,
      }));
      // Không để lần refresh server làm mất các bản ghi còn đang chờ replay.
      const pending = await db.pendingMasterData.toArray();
      const pendingIds = new Set(pending.map((item) => item.local_id));
      const [localProducts, localCustomers, localSuppliers] = await Promise.all([
        db.products.bulkGet([...pendingIds]),
        db.customers.bulkGet([...pendingIds]),
        db.suppliers.bulkGet([...pendingIds]),
      ]);
      const pendingProducts = localProducts.filter((row): row is Product => Boolean(row));
      const pendingCustomers = localCustomers.filter((row): row is Customer => Boolean(row));
      const pendingSuppliers = localSuppliers.filter((row): row is Supplier => Boolean(row));
      const mergePending = <T extends { id: string }>(serverRows: T[], localRows: T[]) => {
        const localById = new Map(localRows.map((row) => [row.id, row]));
        return serverRows.map((row) => localById.get(row.id) || row).concat(
          localRows.filter((row) => !serverRows.some((serverRow) => serverRow.id === row.id))
        );
      };
      const nextProducts = mergePending(mapped, pendingProducts);
      const nextCustomers = mergePending(mappedCustomers, pendingCustomers);
      const nextSuppliers = mergePending(mappedSuppliers, pendingSuppliers);
      // P3-loop fix: giữ identity khi server không có gì mới để cắt vòng lặp
      // effect-pull -> setState -> callback mới -> effect chạy lại.
      setProducts((prev) => stableNext(prev, nextProducts));
      setCustomers((prev) => stableNext(prev, nextCustomers));
      setSuppliers((prev) => stableNext(prev, nextSuppliers));
      setCatalogSource('server');
      try {
        await db.products.clear();
        await db.products.bulkAdd(nextProducts);
        await db.customers.clear();
        await db.customers.bulkAdd(nextCustomers);
        await db.suppliers.clear();
        await db.suppliers.bulkAdd(nextSuppliers);
      } catch {
        /* cache best-effort */
      }
      return true;
    } catch {
      return false;
    }
  }, [supa]);

  // Đẩy master KH lên server (khớp phone -> code). Server giữ nợ hiện hữu (truth).
  const syncCustomers = useCallback(async (): Promise<Record<string, string>> => {
    if (!supa) return customerMap;
    const next: Record<string, string> = { ...customerMap };
    let changed = false;
    for (const c of customers) {
      if (!c.phone || c.id === 'cust-1' || next[c.id]) continue;
      try {
        const { data, error } = await supa.rpc('sync_customer', {
          p_code: c.code,
          p_name: c.name,
          p_phone: c.phone,
          p_address: c.address || null,
          p_group: c.group,
          p_debt_limit: c.debt_limit || 0,
          p_current_debt: c.current_debt || 0,
        });
        const sid = (data as any)?.id;
        if (!error && sid) {
          next[c.id] = sid;
          changed = true;
        }
      } catch {
        /* lỗi từng KH không chặn cả lô */
      }
    }
    if (changed) {
      setCustomerMap(next);
      try {
        localStorage.setItem(CUSTOMER_MAP_KEY, JSON.stringify(next));
      } catch {
        /* best-effort */
      }
    }
    return next;
  }, [supa, customers, customerMap, setCustomerMap]);

  // Master Data Add/Update — P2: thu ngân/worker không được sửa hàng hóa/giá vốn
  const addProduct = useCallback(
    async (data: Omit<Product, 'id' | 'sku'> & { sku?: string }): Promise<Product> => {
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        notify('Chỉ Admin/Quản lý được thêm hàng hóa!', 'error');
        throw new Error('Forbidden: cần quyền quản lý');
      }
      const autoSku = !data.sku;
      let sku = data.sku || generateMasterCode('SP');
      const localProd: Product = {
        ...data,
        id: `prod-${Date.now()}`,
        sku,
        avg_cost: data.avg_cost ?? data.import_price, // INT-ERR-01 fix
      };
      let newProd = localProd;
      if (supa) {
        if (!user) throw new Error('Vui lòng đăng nhập trước khi thêm hàng hóa.');
        if (!isOnline) {
          await queueMasterData('product', 'insert', localProd.id, {
            ...localProd,
            barcode: data.barcode ?? null,
            min_stock: data.min_stock ?? 0,
            waste_factor: data.waste_factor ?? 0,
            default_grinding_price: data.default_grinding_price ?? 0,
          });
          setProducts((prev) => [...prev, localProd]);
          await db.products.put(localProd);
          return localProd;
        }
        let row: any = null;
        let lastError: { code?: string; message?: string } | null = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const result = await supa
            .from('products')
            .insert({
              sku,
              barcode: data.barcode ?? null,
              name: data.name,
              category: data.category,
              unit: data.unit,
              product_type: data.product_type,
              retail_price: data.retail_price,
              trade_price: data.trade_price ?? null,
              import_price: data.import_price,
              avg_cost: localProd.avg_cost,
              stock_quantity: data.stock_quantity,
              min_stock: data.min_stock ?? 0,
              waste_factor: data.waste_factor ?? 0,
              default_grinding_price: data.default_grinding_price ?? 0,
            })
            .select('*')
            .single();
          if (!result.error && result.data) {
            row = result.data;
            break;
          }
          lastError = result.error;
          const duplicateSku =
            result.error?.code === '23505' &&
            /products_sku_key|sku/i.test(result.error.message || '');
          if (!autoSku || !duplicateSku) break;
          sku = generateMasterCode('SP');
        }
        if (!row) throw new Error(lastError?.message || 'Không thể lưu hàng hóa lên máy chủ.');
        newProd = {
          ...localProd,
          sku,
          id: row.id,
          avg_cost: Number(row.avg_cost),
          stock_quantity: Number(row.stock_quantity),
        };
      }
      setProducts((prev) => [...prev, newProd]);
      await db.products.add(newProd);
      return newProd;
    },
    [supa, profile, user, isOnline, queueMasterData]
  );

  const updateProduct = useCallback(async (id: string, updates: Partial<Product>) => {
    if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
      notify('Chỉ Admin/Quản lý được sửa hàng hóa/giá vốn!', 'error');
      return;
    }
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi sửa hàng hóa.');
      if (!isOnline) {
        await queueMasterData('product', 'update', id, updates as Record<string, unknown>);
        setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
        await db.products.update(id, updates);
        return;
      }
      const { error } = await supa.from('products').update(updates).eq('id', id);
      if (error) throw new Error(error.message);
    }
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    await db.products.update(id, updates);
  }, [supa, profile, user, isOnline, queueMasterData]);

  const addCustomer = useCallback(
    async (data: Omit<Customer, 'id' | 'code' | 'created_at'> & { created_at?: string }): Promise<Customer> => {
      let codeNum = customers.length + 1;
      let code = `KH${String(codeNum).padStart(4, '0')}`;
      while (customers.some((c) => c.code === code)) {
        codeNum++;
        code = `KH${String(codeNum).padStart(4, '0')}`;
      }
      const localCust: Customer = {
        ...data,
        id: `cust-${Date.now()}`,
        code,
        created_at: data.created_at || new Date().toISOString(),
      };
      let newCust = localCust;
      if (supa) {
        if (!user) throw new Error('Vui lòng đăng nhập trước khi thêm khách hàng.');
        if (!isOnline) {
          await queueMasterData('customer', 'insert', localCust.id, {
            ...localCust,
            customer_group: data.group,
            phone: data.phone || null,
          });
          setCustomers((prev) => [...prev, localCust]);
          await db.customers.put(localCust);
          return localCust;
        }
        const { data: row, error } = await supa
          .from('customers')
          .insert({
            code,
            name: data.name,
            phone: data.phone || null,
            address: data.address || null,
            customer_group: data.group,
            debt_limit: data.debt_limit || 0,
            current_debt: data.current_debt || 0,
          })
          .select('*')
          .single();
        if (error || !row) throw new Error(error?.message || 'Không thể lưu khách hàng lên máy chủ.');
        newCust = {
          ...localCust,
          id: row.id,
          group: (row.customer_group as Customer['group']) || data.group,
          current_debt: Number(row.current_debt) || 0,
          debt_limit: Number(row.debt_limit) || 0,
          created_at: row.created_at,
        };
      }
      setCustomers((prev) => [...prev, newCust]);
      await db.customers.add(newCust);
      return newCust;
    },
    [customers, supa, user, isOnline, queueMasterData]
  );

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi sửa khách hàng.');
      if (!isOnline) {
        await queueMasterData('customer', 'update', id, {
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.phone !== undefined ? { phone: updates.phone || null } : {}),
          ...(updates.address !== undefined ? { address: updates.address || null } : {}),
          ...(updates.group !== undefined ? { customer_group: updates.group } : {}),
          ...(updates.debt_limit !== undefined ? { debt_limit: updates.debt_limit } : {}),
        });
        setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
        await db.customers.update(id, updates);
        return;
      }
      const payload = {
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.phone !== undefined ? { phone: updates.phone || null } : {}),
        ...(updates.address !== undefined ? { address: updates.address || null } : {}),
        ...(updates.group !== undefined ? { customer_group: updates.group } : {}),
        ...(updates.debt_limit !== undefined ? { debt_limit: updates.debt_limit } : {}),
      };
      const { error } = await supa.from('customers').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
    }
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    await db.customers.update(id, updates);
  }, [supa, user, isOnline, queueMasterData]);

  const addSupplier = useCallback(
    async (data: Omit<Supplier, 'id' | 'code'>): Promise<Supplier> => {
      let codeNum = suppliers.length + 1;
      let code = `NCC${String(codeNum).padStart(4, '0')}`;
      while (suppliers.some((s) => s.code === code)) {
        codeNum++;
        code = `NCC${String(codeNum).padStart(4, '0')}`;
      }
      const localSup: Supplier = {
        ...data,
        id: `sup-${Date.now()}`,
        code,
      };
      let newSup = localSup;
      if (supa) {
        if (!user) throw new Error('Vui lòng đăng nhập trước khi thêm nhà cung cấp.');
        if (!isOnline) {
          await queueMasterData('supplier', 'insert', localSup.id, { ...localSup, phone: data.phone || null });
          setSuppliers((prev) => [...prev, localSup]);
          await db.suppliers.put(localSup);
          return localSup;
        }
        const { data: row, error } = await supa
          .from('suppliers')
          .insert({
            code,
            name: data.name,
            phone: data.phone || null,
            address: data.address || null,
            tax_code: data.tax_code || null,
            current_debt: data.current_debt || 0,
          })
          .select('*')
          .single();
        if (error || !row) throw new Error(error?.message || 'Không thể lưu nhà cung cấp lên máy chủ.');
        newSup = { ...localSup, id: row.id, current_debt: Number(row.current_debt) || 0 };
      }
      setSuppliers((prev) => [...prev, newSup]);
      await db.suppliers.add(newSup);
      return newSup;
    },
    [suppliers, supa, user, isOnline, queueMasterData]
  );

  const updateSupplier = useCallback(async (id: string, updates: Partial<Supplier>) => {
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi sửa nhà cung cấp.');
      if (!isOnline) {
        await queueMasterData('supplier', 'update', id, updates as Record<string, unknown>);
        setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
        await db.suppliers.update(id, updates);
        return;
      }
      const { error } = await supa.from('suppliers').update(updates).eq('id', id);
      if (error) throw new Error(error.message);
    }
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    await db.suppliers.update(id, updates);
  }, [supa, user, isOnline, queueMasterData]);

  // P1 Sửa/Xóa: xóa local + (nếu đã lên server) xóa server (trực tiếp khi online,
  // xếp hàng khi offline). Bản local chưa từng đẩy -> chỉ cần dọn hàng đợi insert/update
  // cùng id để replay sau không "hồi sinh" lại. FK server tự chặn bản ghi đã dùng.
  const deleteCatalogRecord = async (
    entity: PendingMasterData['entity'],
    localId: string,
    serverId: string | null
  ) => {
    // Dọn hàng đợi insert/update cùng id trước để replay sau không hồi sinh
    await db.pendingMasterData.where('local_id').equals(localId).delete().catch(() => {});
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi xóa.');
      if (!isOnline) {
        if (serverId) {
          await queueMasterData(entity, 'delete', localId, { server_id: serverId });
        }
      } else if (serverId) {
        const table = entity === 'product' ? 'products' : entity === 'customer' ? 'customers' : 'suppliers';
        const { error } = await supa.from(table).delete().eq('id', serverId);
        if (error) {
          if (/foreign key|violates|23503/i.test(error.message || ''))
            throw new Error('Bản ghi đã phát sinh giao dịch (đơn/phiếu) nên không thể xóa.');
          throw new Error(error.message);
        }
      }
    }
    if (entity === 'product') {
      setProducts((prev) => prev.filter((p) => p.id !== localId));
      await db.products.delete(localId);
    } else if (entity === 'customer') {
      setCustomers((prev) => prev.filter((c) => c.id !== localId));
      await db.customers.delete(localId);
      setCustomerMap((prev) => {
        if (!(localId in prev)) return prev;
        const next = { ...prev };
        delete next[localId];
        try {
          localStorage.setItem(CUSTOMER_MAP_KEY, JSON.stringify(next));
        } catch {
          /* best-effort */
        }
        return next;
      });
    } else {
      setSuppliers((prev) => prev.filter((s) => s.id !== localId));
      await db.suppliers.delete(localId);
    }
  };

  const deleteProduct = useCallback(
    async (id: string) => {
      const serverId = IS_UUID_RE.test(id) ? id : null;
      await deleteCatalogRecord('product', id, serverId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supa, user, isOnline]
  );

  const deleteCustomer = useCallback(
    async (id: string) => {
      const serverId = customerMap[id] ?? (IS_UUID_RE.test(id) ? id : null);
      await deleteCatalogRecord('customer', id, serverId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supa, user, isOnline, customerMap]
  );

  const deleteSupplier = useCallback(
    async (id: string) => {
      const serverId = IS_UUID_RE.test(id) ? id : null;
      await deleteCatalogRecord('supplier', id, serverId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supa, user, isOnline]
  );

  const value: CatalogSlice = {
    products,
    suppliers,
    customers,
    customerMap,
    catalogSource,
    setProducts,
    setSuppliers,
    setCustomers,
    refreshCatalog,
    syncMasterData,
    syncCustomers,
    addProduct,
    updateProduct,
    addCustomer,
    updateCustomer,
    addSupplier,
    updateSupplier,
    deleteProduct,
    deleteCustomer,
    deleteSupplier,
  };
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogSlice {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider');
  return ctx;
}
