'use client';

import { CheckCircle2, HardHat, Menu, ShoppingBag, Truck } from 'lucide-react';
import { formatVND } from '@/lib/format';
import type { PosFlow } from '@/lib/types';

interface MobilePOSDockProps {
  /** Luồng POS hiện tại: bán hàng / nhập kho / xuất vật tư công trình (nhãn + id nút theo đúng luồng) */
  flow: PosFlow;
  itemCount: number;
  total: number;
  disabled: boolean;
  onOpenMenu: () => void;
  onOpenCart: () => void;
  onPrimaryAction: () => void;
}

export function MobilePOSDock({
  flow,
  itemCount,
  total,
  disabled,
  onOpenMenu,
  onOpenCart,
  onPrimaryAction,
}: MobilePOSDockProps) {
  const isSale = flow === 'sale';
  const isProject = flow === 'project';
  const PrimaryIcon = isProject ? HardHat : isSale ? CheckCircle2 : Truck;
  const hasItems = itemCount > 0;

  // Nhãn theo luồng: trước đây gộp chung boolean nên Xuất CT hiện nhầm "Dòng nhập"/"Lưu phiếu".
  const cartLabel = isProject ? 'Dòng xuất' : isSale ? 'Giỏ hàng' : 'Dòng nhập';
  const primaryLabel = isProject ? 'Xuất vật tư' : isSale ? (hasItems ? 'Thanh toán' : 'Thêm hàng') : 'Lưu phiếu';
  const primaryId = isProject
    ? 'btn-pos-mobile-project-export'
    : isSale
      ? 'btn-pos-mobile-checkout'
      : 'btn-pos-mobile-import';

  return (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur safe-bottom">
      <div className="mx-auto flex max-w-xl items-center gap-2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Mở menu phân hệ"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 active:bg-slate-100"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          id="btn-pos-mobile-cart"
          type="button"
          onClick={onOpenCart}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left active:bg-slate-50"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            {isProject ? (
              <HardHat className="h-4 w-4" />
            ) : isSale ? (
              <ShoppingBag className="h-4 w-4" />
            ) : (
              <Truck className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-medium text-slate-500">{cartLabel}</span>
            <span className="block truncate text-xs font-bold text-slate-800">
              {itemCount} dòng · {formatVND(total)}
            </span>
          </span>
        </button>
        <button
          id={primaryId}
          type="button"
          disabled={disabled}
          onClick={onPrimaryAction}
          className={`flex h-12 min-w-[7.5rem] shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-extrabold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            disabled
              ? 'bg-slate-400 active:bg-slate-500'
              : isSale
                ? 'bg-blue-700 active:bg-blue-800'
                : 'bg-emerald-600 active:bg-emerald-700'
          }`}
        >
          <PrimaryIcon className="h-4 w-4" />
          <span>{primaryLabel}</span>
        </button>
      </div>
    </div>
  );
}
