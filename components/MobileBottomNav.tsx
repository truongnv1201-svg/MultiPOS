'use client';

import type { ElementType } from 'react';
import { MoreHorizontal, PackagePlus, ReceiptText, ShoppingCart, Users } from 'lucide-react';
import type { ActiveScreen } from '@/lib/types';
import { useStore } from '@/lib/store';

interface NavItem {
  screen: ActiveScreen;
  label: string;
  icon: ElementType;
}

export function MobileBottomNav() {
  const { currentScreen, setCurrentScreen, setFlyoutMenuOpen, profile } = useStore();
  const restricted = profile?.role === 'cashier' || profile?.role === 'worker';
  const items: NavItem[] = [
    { screen: 'pos', label: 'Bán', icon: ShoppingCart },
    ...(!restricted ? [{ screen: 'inventory' as const, label: 'Kho', icon: PackagePlus }] : []),
    { screen: 'orders', label: 'Đơn', icon: ReceiptText },
    { screen: 'customers', label: 'Khách', icon: Users },
  ];

  if (currentScreen === 'pos') return null;

  return (
    <nav
      aria-label="Điều hướng nhanh"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pt-1.5 shadow-[0_-6px_20px_rgba(15,23,42,0.1)] backdrop-blur safe-bottom"
    >
      <div className="mx-auto flex max-w-xl items-center justify-around gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = currentScreen === item.screen;
          return (
            <button
              key={item.screen}
              type="button"
              onClick={() => setCurrentScreen(item.screen)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold ${
                active ? 'text-blue-700' : 'text-slate-500 active:bg-slate-50'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setFlyoutMenuOpen(true)}
          aria-label="Mở thêm phân hệ"
          className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold text-slate-500 active:bg-slate-50"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>Thêm</span>
        </button>
      </div>
    </nav>
  );
}
