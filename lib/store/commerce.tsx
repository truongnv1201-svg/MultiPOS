// P3-phần 2: slice Commerce — shop info, cấu hình in, VietQR, giá mài, làm tròn tiền mặt.
// Đồng bộ server: thông tin cửa hàng + số dư đầu kỳ + giá mài.
// GIỮ RIÊNG từng máy trạm (localStorage, không đẩy/kéo server): mặc định POS
// (VAT/thanh toán/bảng giá), VietQR, mẫu in, tùy chọn in, nội dung phiếu
// (kể cả lời cảm ơn + chính sách đổi trả).
// Phụ thuộc duy nhất: AuthSlice (supa/profile) để guard RBAC.
'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './auth';
import { GRINDING_TYPES } from '../mock-data';
import type { VietqrConfig } from '../vietqr';
import {
  DEFAULT_SHOP,
  normalizePrintTemplate,
  normalizePrinterWidth,
} from './shop';
import type { ShopSettings, GrindingService } from './shop';
import { vietnamizeError } from '../error-vi';
import { notify } from '@/components/common/Toast';

export interface CommerceSlice {
  shop: ShopSettings;
  updateShop: (patch: Partial<ShopSettings>) => void;
  saveShopSettings: () => Promise<string | null>;
  refreshShopSettings: () => Promise<boolean>;
  vietqr: VietqrConfig;
  updateVietqr: (patch: Partial<VietqrConfig>) => void;
  grindingServices: GrindingService[];
  refreshGrinding: () => Promise<boolean>;
  updateGrindingPrice: (id: string, price: number) => Promise<string | null>;
}

const CommerceContext = createContext<CommerceSlice | null>(null);

const LOCAL_SHOP_KEYS: (keyof ShopSettings)[] = [
  'printerWidth',
  'printTemplate',
  'printCopies',
  'autoPrint',
  'showLogo',
  'showCashier',
  'showCustomerPhone',
  'showVietqr',
  'showDimensions',
  'showDebt',
  'fontSize',
  // Mặc định bán hàng theo từng máy trạm (máy quầy khác máy kho...).
  'defaultVat',
  'defaultPayment',
  'defaultPriceBook',
  // Lời cảm ơn + chính sách đổi trả in cuối phiếu cũng theo từng máy.
  'footerThanks',
  'receiptPolicy',
];

function sharedShopSettings(settings: ShopSettings): Partial<ShopSettings> {
  const localKeys = new Set<keyof ShopSettings>(LOCAL_SHOP_KEYS);
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !localKeys.has(key as keyof ShopSettings))
  ) as Partial<ShopSettings>;
}

export function CommerceProvider({ children }: { children: React.ReactNode }) {
  const { supa, profile } = useAuth();

  // Thương mại: shop info + VietQR theo máy trạm (localStorage)
  // 'card' đã bỏ khỏi UI chọn -> máy cũ còn lưu thì về 'transfer' (cùng cách tính tiền).
  const [shop, setShop] = useState<ShopSettings>(() => {
    try {
      const raw = localStorage.getItem('multipos_shop_v1');
      if (!raw) return DEFAULT_SHOP;
      const parsed = JSON.parse(raw);
      if ((parsed as any)?.defaultPayment === 'card') parsed.defaultPayment = 'transfer';
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
      notify('Chỉ tài khoản Admin được đổi thông tin cửa hàng.', 'error');
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
  }, [supa, profile]);

  const saveShopSettings = useCallback(async (): Promise<string | null> => {
    if (!supa) return null;
    if (profile?.role !== 'admin') return 'Chỉ tài khoản Admin được lưu cấu hình cửa hàng.';
    const { error } = await supa.from('settings').upsert(
      { key: 'shop_profile', value: sharedShopSettings(shop) },
      { onConflict: 'key' }
    );
    return error ? vietnamizeError(error) : null;
  }, [supa, profile, shop]);

  const refreshShopSettings = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    const { data, error } = await supa.from('settings').select('value').eq('key', 'shop_profile').maybeSingle();
    if (error || !data?.value) return false;
    const serverShop = data.value as Partial<ShopSettings>;
    setShop((prev) => {
      const localSettings = Object.fromEntries(
        LOCAL_SHOP_KEYS.map((key) => [key, prev[key]])
      ) as Partial<ShopSettings>;
      const next = {
        ...DEFAULT_SHOP,
        ...localSettings,
        ...serverShop,
        ...localSettings,
        printTemplate: normalizePrintTemplate(serverShop.printTemplate ?? prev.printTemplate),
        printerWidth: normalizePrinterWidth(serverShop.printerWidth ?? prev.printerWidth),
      };
      try { localStorage.setItem('multipos_shop_v1', JSON.stringify(next)); } catch {}
      return next;
    });
    return true;
  }, [supa]);

  // Kéo cấu hình dùng chung từ server (effect tổng đặt cuối, sau mọi định nghĩa).

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
      notify('Chỉ tài khoản Admin được đổi VietQR.', 'error');
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

  // VietQR theo từng máy trạm (localStorage only) — xem updateVietqr phía trên.

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

  // Vừa online / vừa có supa -> kéo cấu hình chung từ server về máy này
  // (VietQR + mặc định POS + nội dung phiếu giữ local, không kéo).
  useEffect(() => {
    if (!supa) return;
    Promise.resolve().then(() => {
      refreshShopSettings();
    });
  }, [supa, refreshShopSettings]);

  const value: CommerceSlice = {
    shop,
    updateShop,
    saveShopSettings,
    refreshShopSettings,
    vietqr,
    updateVietqr,
    grindingServices,
    refreshGrinding,
    updateGrindingPrice,
  };
  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
}

export function useCommerce(): CommerceSlice {
  const ctx = useContext(CommerceContext);
  if (!ctx) throw new Error('useCommerce must be used within CommerceProvider');
  return ctx;
}
