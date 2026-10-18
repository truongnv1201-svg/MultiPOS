// P3-phần 2: slice Commerce — shop info, cấu hình in, VietQR, giá mài, làm tròn tiền mặt.
// Đồng bộ server: thông tin cửa hàng + số dư đầu kỳ + giá mài.
// GIỮ RIÊNG từng máy trạm (localStorage, không đẩy/kéo server): mặc định POS
// (VAT/thanh toán/bảng giá), VietQR, mẫu in, tùy chọn in, nội dung phiếu
// (kể cả lời cảm ơn + chính sách đổi trả).
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

const LOCAL_SHOP_KEY_SET = new Set<string>(LOCAL_SHOP_KEYS);

/** Khoá cấu hình theo máy trạm: không đẩy/kéo server, ai đang dùng máy cũng đổi được. */
function isLocalShopKey(key: string): boolean {
  return LOCAL_SHOP_KEY_SET.has(key);
}

/** Phần cấu hình gửi lên server (bỏ mọi khoá theo máy trạm). */
function sharedShopSettings(settings: Partial<ShopSettings>): Partial<ShopSettings> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !isLocalShopKey(key))
  ) as Partial<ShopSettings>;
}

/** Gộp cấu hình dùng chung kéo từ server vào cấu hình máy này:
 *  - khoá server sở hữu (tên cửa hàng, hotline, số dư đầu kỳ…) lấy theo server;
 *  - khoá theo máy trạm (mẫu in/khổ giấy, mặc định POS, nội dung phiếu) LUÔN giữ của máy này.
 *  `current` phải là giá trị MỚI NHẤT (không phải bản chụp lúc tạo request) — nếu không,
 *  request về muộn sẽ ghi đè lựa chọn người dùng vừa bấm. */
function mergeShopSettings(current: ShopSettings, serverShop: Partial<ShopSettings>): ShopSettings {
  const fromServer = sharedShopSettings(serverShop);
  return { ...DEFAULT_SHOP, ...current, ...fromServer };
}

/** So sánh nông hai cấu hình (object phẳng, toàn giá trị nguyên thuỷ) để khỏi setState thừa. */
function sameShop(a: ShopSettings, b: ShopSettings): boolean {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as keyof ShopSettings] !== b[key as keyof ShopSettings]) return false;
  }
  return true;
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
  // Cấu hình hiện tại: state cho React render + ref cho callback async đọc giá trị MỚI NHẤT.
  // (Cách gộp cũ lấy `shop` trong closure của lần render đã tạo request, nên request về muộn
  //  ghi đè lại lựa chọn người dùng vừa bấm — nhãn khổ giấy "nhảy" ngược về khổ cũ.)
  const shopRef = useRef(shop);

  /** Ghi cấu hình mới ở cả 3 nơi: ref (cho async), state (React) và localStorage (máy trạm). */
  const applyShop = useCallback((next: ShopSettings) => {
    shopRef.current = next;
    setShop(next);
    try {
      localStorage.setItem('multipos_shop_v1', JSON.stringify(next));
    } catch {
      /* best-effort */
    }
  }, []);

  const updateShop = useCallback((patch: Partial<ShopSettings>) => {
    // P2: thông tin DÙNG CHUNG (tên cửa hàng, hotline, số dư đầu kỳ…) chỉ Admin được đổi.
    // Còn cấu hình THEO MÁY TRẠM (mẫu in/khổ giấy, mặc định POS, nội dung phiếu) thì ai đang
    // dùng máy này cũng đổi được — khổ giấy là việc của máy in ở quầy, không phải cấu hình
    // kinh doanh (trước đây thu ngân chọn mẫu in bị chặn, chọn xong không lưu được gì).
    const touchesShared = Object.keys(patch).some((key) => !isLocalShopKey(key));
    if (supa && profile?.role !== 'admin' && touchesShared) {
      notify('Chỉ tài khoản Admin được đổi thông tin cửa hàng.', 'error');
      return;
    }
    const next: ShopSettings = { ...shopRef.current, ...patch };
    if (patch.printTemplate) next.printTemplate = normalizePrintTemplate(patch.printTemplate);
    if (patch.printerWidth) next.printerWidth = normalizePrinterWidth(patch.printerWidth);
    applyShop(next);
  }, [supa, profile, applyShop]);

  const saveShopSettings = useCallback(async (): Promise<string | null> => {
    if (!supa) return null;
    if (profile?.role !== 'admin') return 'Chỉ tài khoản Admin được lưu cấu hình cửa hàng.';
    const { error } = await supa.from('settings').upsert(
      { key: 'shop_profile', value: sharedShopSettings(shopRef.current) },
      { onConflict: 'key' }
    );
    return error ? vietnamizeError(error) : null;
  }, [supa, profile]);

  const refreshShopSettings = useCallback(async (): Promise<boolean> => {
    if (!supa) return false;
    const { data, error } = await supa.from('settings').select('value').eq('key', 'shop_profile').maybeSingle();
    if (error || !data?.value) return false;
    // Gộp theo giá trị mới nhất (shopRef) — xem chú thích ở shopRef.
    const next = mergeShopSettings(shopRef.current, data.value as Partial<ShopSettings>);
    if (!sameShop(shopRef.current, next)) applyShop(next);
    return true;
  }, [supa, applyShop]);

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
    const next: VietqrConfig = { ...vietqr, ...patch };
    setVietqr(next);
    try {
      localStorage.setItem('multipos_vietqr_v1', JSON.stringify(next));
    } catch {
      /* best-effort */
    }
  }, [supa, profile, vietqr]);

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
  // refreshShopSettings giờ chỉ phụ thuộc `supa` nên effect chạy đúng 1 lần cho mỗi client:
  // trước đây hàm này còn phụ thuộc `shop` và luôn setShop object mới -> effect tự gọi lại
  // chính nó, tạo vòng lặp request vô hạn + ghi đè mọi lựa chọn người dùng vừa bấm.
  useEffect(() => {
    if (!supa) return;
    Promise.resolve().then(() => {
      void refreshShopSettings();
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
