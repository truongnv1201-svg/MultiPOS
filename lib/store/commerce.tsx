// P3-phần 2: slice Commerce — shop info, VietQR, giá mài, làm tròn tiền mặt.
// Setting máy trạm lưu localStorage; giá mài + làm tròn đọc/tuân server (chỉ Admin được đổi).
// Phụ thuộc duy nhất: AuthSlice (supa/profile) để guard RBAC.
'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { GRINDING_TYPES } from '../mock-data';
import type { VietqrConfig } from '../vietqr';
import {
  DEFAULT_SHOP,
  normalizePrintTemplate,
  normalizePrinterWidth,
} from './shop';
import type { ShopSettings, GrindingService, Branch } from './shop';
import { vietnamizeError } from '../error-vi';

export interface CommerceSlice {
  shop: ShopSettings;
  updateShop: (patch: Partial<ShopSettings>) => void;
  branches: Branch[];
  branchId: string | null;
  branchName: string;
  selectBranch: (id: string) => Promise<string | null>;
  refreshShopSettings: () => Promise<boolean>;
  vietqr: VietqrConfig;
  updateVietqr: (patch: Partial<VietqrConfig>) => void;
  grindingServices: GrindingService[];
  refreshGrinding: () => Promise<boolean>;
  updateGrindingPrice: (id: string, price: number) => Promise<string | null>;
  cashRounding: number;
  refreshCashRounding: () => Promise<boolean>;
  updateCashRounding: (denominator: number) => Promise<string | null>;
}

const CommerceContext = createContext<CommerceSlice | null>(null);

export function CommerceProvider({ children }: { children: React.ReactNode }) {
  const { supa, user, profile } = useAuth();
  const shopSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Thương mại: shop info + VietQR theo máy trạm (localStorage)
  const [shop, setShop] = useState<ShopSettings>(() => {
    try {
      const raw = localStorage.getItem('multipos_shop_v1');
      if (!raw) return DEFAULT_SHOP;
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SHOP,
        ...parsed,
        printTemplate: normalizePrintTemplate((parsed as any)?.printTemplate),
        printerWidth: normalizePrinterWidth((parsed as any)?.printerWidth),
      };
    } catch {
      return DEFAULT_SHOP;
    }
  });
  const updateShop = useCallback((patch: Partial<ShopSettings>) => {
    // P2: chỉ Admin được đổi thông tin cửa hàng (manager cũng bị chặn).
    // Local-only (chưa cấu hình Supabase) vẫn cho đổi để demo/cài đặt máy trạm.
    if (supa && profile?.role !== 'admin') {
      alert('Chỉ tài khoản Admin được đổi thông tin cửa hàng.');
      return;
    }
    setShop((prev) => {
      const next = { ...prev, ...patch };
      if ((patch as any)?.printTemplate) next.printTemplate = normalizePrintTemplate((patch as any).printTemplate);
      if ((patch as any)?.printerWidth) next.printerWidth = normalizePrinterWidth((patch as any).printerWidth);
      try {
        localStorage.setItem('multipos_shop_v1', JSON.stringify(next));
      } catch {
        /* best-effort */
      }
      return next;
    });
    if (supa && profile?.role === 'admin') {
      if (shopSyncTimer.current) clearTimeout(shopSyncTimer.current);
      shopSyncTimer.current = setTimeout(async () => {
        const raw = localStorage.getItem('multipos_shop_v1');
        if (!raw) return;
        const { error } = await supa.from('settings').upsert({ key: 'shop_profile', value: JSON.parse(raw) }, { onConflict: 'key' });
        if (error) console.warn('Shop settings sync failed:', error.message);
      }, 500);
    }
  }, [supa, profile]);

  const refreshShopSettings = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    const { data, error } = await supa.from('settings').select('value').eq('key', 'shop_profile').maybeSingle();
    if (error || !data?.value) return false;
    const serverShop = data.value as Partial<ShopSettings>;
    setShop((prev) => {
      const next = {
        ...DEFAULT_SHOP,
        ...serverShop,
        printTemplate: normalizePrintTemplate(serverShop.printTemplate ?? prev.printTemplate),
        printerWidth: normalizePrinterWidth(serverShop.printerWidth ?? prev.printerWidth),
      };
      try { localStorage.setItem('multipos_shop_v1', JSON.stringify(next)); } catch {}
      return next;
    });
    return true;
  }, [supa]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(profile?.branch_id || null);
  const refreshBranches = useCallback(async () => {
    if (!supa || !user) return;
    const { data, error } = await supa.from('branches').select('id, name, address').order('name');
    if (!error && data) setBranches(data as Branch[]);
  }, [supa, user]);
  useEffect(() => {
    if (!supa || !user) return;
    Promise.resolve().then(() => {
      refreshShopSettings();
      refreshBranches();
    });
  }, [supa, user, refreshShopSettings, refreshBranches]);
  const selectBranch = useCallback(async (id: string): Promise<string | null> => {
    if (!supa || !user) return 'Vui lòng đăng nhập để chọn chi nhánh.';
    if (!branches.some((branch) => branch.id === id)) return 'Chi nhánh không tồn tại.';
    if (profile?.role !== 'admin' && profile?.branch_id && profile.branch_id !== id) {
      return 'Tài khoản này chỉ được làm việc tại chi nhánh đã phân quyền.';
    }
    const { error } = await supa.from('profiles').update({ branch_id: id }).eq('id', user.id);
    if (error) return vietnamizeError(error);
    setBranchId(id);
    return null;
  }, [supa, user, branches, profile]);
  const activeBranchId = branchId || profile?.branch_id || null;
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const branchName = activeBranch?.name || 'Chi nhánh 1 (Tổng kho)';

  const [vietqr, setVietqr] = useState<VietqrConfig>(() => {
    try {
      const raw = localStorage.getItem('multipos_vietqr_v1');
      return raw ? JSON.parse(raw) : { bank: '', account: '', name: '' };
    } catch {
      return { bank: '', account: '', name: '' };
    }
  });
  const updateVietqr = useCallback((patch: Partial<VietqrConfig>) => {
    // P2: chỉ Admin được đổi VietQR.
    if (supa && profile?.role !== 'admin') {
      alert('Chỉ tài khoản Admin được đổi VietQR.');
      return;
    }
    setVietqr((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('multipos_vietqr_v1', JSON.stringify(next));
      } catch {
        /* best-effort */
      }
      return next;
    });
  }, [supa, profile]);

  // Thương mại: giá công mài từ server (fallback mock khi offline)
  const [grindingServices, setGrindingServices] = useState<GrindingService[]>(() =>
    GRINDING_TYPES.map((g) => ({ id: g.id, label: g.label.split(' (')[0], price_per_md: g.price_per_md }))
  );
  const refreshGrinding = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const { data, error } = await supa.from('grinding_services').select('*').order('price_per_md');
      if (error || !data) return false;
      setGrindingServices(
        (data as any[]).map((r) => ({ id: r.id, label: r.label, price_per_md: Number(r.price_per_md) }))
      );
      return true;
    } catch {
      return false;
    }
  }, [supa]);
  // Ghi giá mài: P2 chỉ Admin (RLS grinding_admin_write cưỡng chế)
  const updateGrindingPrice = useCallback(
    async (id: string, price: number): Promise<string | null> => {
      if (!supa) return 'Chưa cấu hình Supabase.';
      if (profile?.role !== 'admin') return 'Chỉ tài khoản Admin được đổi giá công mài.';
      const { error } = await supa.from('grinding_services').update({ price_per_md: price }).eq('id', id);
      if (error) return vietnamizeError(error);
      await refreshGrinding();
      return null;
    },
    [supa, profile, refreshGrinding]
  );

  // Thương mại: mệnh giá làm tròn tiền mặt (server settings.cash_rounding)
  const [cashRounding, setCashRounding] = useState<number>(500);
  const refreshCashRounding = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    try {
      const { data, error } = await supa.from('settings').select('value').eq('key', 'cash_rounding').maybeSingle();
      const denom = Number((data as any)?.value?.denominator);
      if (error || !denom) return false;
      setCashRounding(denom);
      return true;
    } catch {
      return false;
    }
  }, [supa]);
  const updateCashRounding = useCallback(
    async (denominator: number): Promise<string | null> => {
      if (!supa) return 'Chưa cấu hình Supabase.';
      if (profile?.role !== 'admin') return 'Chỉ tài khoản Admin được đổi làm tròn.';
      if (![100, 500, 1000, 5000].includes(denominator)) return 'Mệnh giá chỉ chấp nhận 100 / 500 / 1.000 / 5.000đ.';
      const { error } = await supa
        .from('settings')
        .update({ value: { denominator } })
        .eq('key', 'cash_rounding');
      if (error) return vietnamizeError(error);
      setCashRounding(denominator);
      return null;
    },
    [supa, profile]
  );

  const value: CommerceSlice = {
    shop,
    updateShop,
    branches,
    branchId: activeBranchId,
    branchName,
    selectBranch,
    refreshShopSettings,
    vietqr,
    updateVietqr,
    grindingServices,
    refreshGrinding,
    updateGrindingPrice,
    cashRounding,
    refreshCashRounding,
    updateCashRounding,
  };
  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
}

export function useCommerce(): CommerceSlice {
  const ctx = useContext(CommerceContext);
  if (!ctx) throw new Error('useCommerce must be used within CommerceProvider');
  return ctx;
}
