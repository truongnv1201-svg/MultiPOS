// P3-phần 2 (tiếp): slice Catalog — master data hàng hóa/KH/NCC + đồng bộ server.
// Sở hữu state + setter + CRUD đơn giản; tầng Transactions (StoreInner) consume để đọc/ghi
// khi checkout/hủy/nhập kho. Phụ thuộc duy nhất: AuthSlice (supa/profile) cho RBAC + sync.
'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from './auth';
import type { Product, Customer, Supplier } from '../types';
import { db, generateMasterCode } from '../db';

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
  syncCustomers: () => Promise<Record<string, string>>;
  addProduct: (data: Omit<Product, 'id' | 'sku'> & { sku?: string }) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  addCustomer: (data: Omit<Customer, 'id' | 'code' | 'created_at'> & { created_at?: string }) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  addSupplier: (data: Omit<Supplier, 'id' | 'code'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
}

const CatalogContext = createContext<CatalogSlice | null>(null);

// 0009: map id KH local -> uuid server, persist localStorage (sống qua reload)
const CUSTOMER_MAP_KEY = 'multipos_customer_map_v1';

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { supa, user, profile } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalogSource, setCatalogSource] = useState<'local' | 'server'>('local');

  // P3: tải catalog từ server (anon SELECT, RLS read-only). Thất bại -> giữ local.
  const refreshCatalog = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const [productsResult, customersResult, suppliersResult] = await Promise.all([
        supa.from('products').select('*').order('sku'),
        supa.from('customers').select('*').order('code'),
        supa.from('suppliers').select('*').order('code'),
      ]);
      const { data, error } = productsResult;
      if (error || !data || customersResult.error || suppliersResult.error) return false;
      const mapped: Product[] = (data as any[]).map((row) => ({
        id: row.id,
        sku: row.sku,
        barcode: row.barcode ?? undefined,
        name: row.name,
        category: row.category,
        unit: row.unit,
        product_type: row.product_type,
        retail_price: Number(row.retail_price),
        trade_price: row.trade_price != null ? Number(row.trade_price) : undefined,
        import_price: Number(row.import_price),
        avg_cost: Number(row.avg_cost),
        stock_quantity: Number(row.stock_quantity),
        min_stock: row.min_stock != null ? Number(row.min_stock) : undefined,
        waste_factor: row.waste_factor != null ? Number(row.waste_factor) : undefined,
        default_grinding_price: row.default_grinding_price != null ? Number(row.default_grinding_price) : undefined,
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
      setCustomers(mappedCustomers);
      setSuppliers(mappedSuppliers);
      setCatalogSource('server');
      try {
        await db.products.clear();
        await db.products.bulkAdd(mapped);
        await db.customers.clear();
        await db.customers.bulkAdd(mappedCustomers);
        await db.suppliers.clear();
        await db.suppliers.bulkAdd(mappedSuppliers);
      } catch {
        /* cache best-effort */
      }
      return true;
    } catch {
      return false;
    }
  }, [supa]);

  const [customerMap, setCustomerMap] = useState<Record<string, string>>(() => {
    try {
      if (typeof window === 'undefined') return {};
      return JSON.parse(localStorage.getItem(CUSTOMER_MAP_KEY) || '{}');
    } catch {
      return {};
    }
  });

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
  }, [supa, customers, customerMap]);

  // Master Data Add/Update — P2: thu ngân/worker không được sửa hàng hóa/giá vốn
  const addProduct = useCallback(
    async (data: Omit<Product, 'id' | 'sku'> & { sku?: string }): Promise<Product> => {
      if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
        alert('Chỉ Admin/Quản lý được thêm hàng hóa!');
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
    [supa, profile, user]
  );

  const updateProduct = useCallback(async (id: string, updates: Partial<Product>) => {
    if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
      alert('Chỉ Admin/Quản lý được sửa hàng hóa/giá vốn!');
      return;
    }
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi sửa hàng hóa.');
      const { error } = await supa.from('products').update(updates).eq('id', id);
      if (error) throw new Error(error.message);
    }
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    await db.products.update(id, updates);
  }, [supa, profile, user]);

  const addCustomer = useCallback(
    async (data: Omit<Customer, 'id' | 'code' | 'created_at'> & { created_at?: string }): Promise<Customer> => {
      const code = `KH${String(customers.length + 1).padStart(4, '0')}`;
      const localCust: Customer = {
        ...data,
        id: `cust-${Date.now()}`,
        code,
        created_at: data.created_at || new Date().toISOString(),
      };
      let newCust = localCust;
      if (supa) {
        if (!user) throw new Error('Vui lòng đăng nhập trước khi thêm khách hàng.');
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
          current_debt: Number(row.current_debt) || 0,
          debt_limit: Number(row.debt_limit) || 0,
          created_at: row.created_at,
        };
      }
      setCustomers((prev) => [...prev, newCust]);
      await db.customers.add(newCust);
      return newCust;
    },
    [customers.length, supa, user]
  );

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi sửa khách hàng.');
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
  }, [supa, user]);

  const addSupplier = useCallback(
    async (data: Omit<Supplier, 'id' | 'code'>): Promise<Supplier> => {
      const code = generateMasterCode('NCC', suppliers.length + 1);
      const localSup: Supplier = {
        ...data,
        id: `sup-${Date.now()}`,
        code,
      };
      let newSup = localSup;
      if (supa) {
        if (!user) throw new Error('Vui lòng đăng nhập trước khi thêm nhà cung cấp.');
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
    [suppliers.length, supa, user]
  );

  const updateSupplier = useCallback(async (id: string, updates: Partial<Supplier>) => {
    if (supa) {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi sửa nhà cung cấp.');
      const { error } = await supa.from('suppliers').update(updates).eq('id', id);
      if (error) throw new Error(error.message);
    }
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    await db.suppliers.update(id, updates);
  }, [supa, user]);

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
    syncCustomers,
    addProduct,
    updateProduct,
    addCustomer,
    updateCustomer,
    addSupplier,
    updateSupplier,
  };
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogSlice {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider');
  return ctx;
}
