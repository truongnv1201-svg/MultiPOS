// P3-phần 2 (tiếp): slice Catalog — master data hàng hóa/KH/NCC + đồng bộ server.
// Sở hữu state + setter + CRUD đơn giản; tầng Transactions (StoreInner) consume để đọc/ghi
// khi checkout/hủy/nhập kho. Phụ thuộc duy nhất: AuthSlice (supa/profile) cho RBAC + sync.
'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from './auth';
import type { Product, Customer, Supplier } from '../types';
import {
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
} from '../mock-data';
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
  const { supa, profile } = useAuth();

  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [suppliers, setSuppliers] = useState<Supplier[]>(INITIAL_SUPPLIERS);
  const [catalogSource, setCatalogSource] = useState<'local' | 'server'>('local');

  // P3: tải catalog từ server (anon SELECT, RLS read-only). Thất bại -> giữ local.
  const refreshCatalog = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const { data, error } = await supa.from('products').select('*').order('sku');
      if (error || !data) return false;
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
      setCatalogSource('server');
      try {
        await db.products.clear();
        await db.products.bulkAdd(mapped);
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
      const sku = data.sku || generateMasterCode('SP');
      const newProd: Product = {
        ...data,
        id: `prod-${Date.now()}`,
        sku,
        avg_cost: data.avg_cost ?? data.import_price, // INT-ERR-01 fix
      };
      setProducts((prev) => [...prev, newProd]);
      await db.products.add(newProd);
      return newProd;
    },
    [supa, profile]
  );

  const updateProduct = useCallback(async (id: string, updates: Partial<Product>) => {
    if (supa && profile?.role !== 'admin' && profile?.role !== 'manager') {
      alert('Chỉ Admin/Quản lý được sửa hàng hóa/giá vốn!');
      return;
    }
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    await db.products.update(id, updates);
  }, [supa, profile]);

  const addCustomer = useCallback(
    async (data: Omit<Customer, 'id' | 'code' | 'created_at'> & { created_at?: string }): Promise<Customer> => {
      const code = `KH${String(customers.length + 1).padStart(4, '0')}`;
      const newCust: Customer = {
        ...data,
        id: `cust-${Date.now()}`,
        code,
        created_at: data.created_at || new Date().toISOString(),
      };
      setCustomers((prev) => [...prev, newCust]);
      await db.customers.add(newCust);
      return newCust;
    },
    [customers.length]
  );

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    await db.customers.update(id, updates);
  }, []);

  const addSupplier = useCallback(
    async (data: Omit<Supplier, 'id' | 'code'>): Promise<Supplier> => {
      const code = generateMasterCode('NCC', suppliers.length + 1);
      const newSup: Supplier = {
        ...data,
        id: `sup-${Date.now()}`,
        code,
      };
      setSuppliers((prev) => [...prev, newSup]);
      await db.suppliers.add(newSup);
      return newSup;
    },
    [suppliers.length]
  );

  const updateSupplier = useCallback(async (id: string, updates: Partial<Supplier>) => {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    await db.suppliers.update(id, updates);
  }, []);

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
