'use client';

import React, { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { ActiveScreen } from '@/lib/types';
import {
  ShoppingCart,
  ReceiptText,
  Boxes,
  PackagePlus,
  Users,
  Truck,
  Building2,
  ClipboardCheck,
  ScrollText,
  Banknote,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  X,
  Store,
  UserCheck,
} from 'lucide-react';

interface MenuItem {
  screen: ActiveScreen;
  label: string;
  icon: React.ElementType;
  shortcut: string;
  badge?: string;
}

export function FlyoutMenu() {
  const {
    flyoutMenuOpen,
    setFlyoutMenuOpen,
    currentScreen,
    setCurrentScreen,
    setShiftModalOpen,
    profile,
    supabaseReady,
  } = useStore();

  const isRestricted = profile?.role === 'cashier' || profile?.role === 'worker';
  // Manager được vào Cài đặt để tự thêm/quản lý NV (cấu hình hệ thống vẫn chỉ Admin sửa được).
  const canAccessSettings = profile?.role === 'admin' || profile?.role === 'manager';
  const menuItems: MenuItem[] = [
    { screen: 'pos', label: 'Màn hình Bán hàng (POS)', icon: ShoppingCart, shortcut: 'F2' },
    { screen: 'orders', label: 'Quản lý Hóa đơn & Đơn hàng', icon: ReceiptText, shortcut: 'Alt + H' },
    { screen: 'products', label: 'Danh mục Hàng hóa & Bảng giá', icon: Boxes, shortcut: 'Alt + P' },
    // P2: thu ngân/worker bị ẩn kho + báo cáo + cài đặt; manager bị ẩn cài đặt hệ thống
    ...(!isRestricted
      ? [
          { screen: 'inventory' as const, label: 'Nhập hàng & Kiểm kho', icon: PackagePlus, shortcut: 'Alt + N' },
        ]
      : []),
    { screen: 'customers', label: 'Khách hàng & Quản lý Công nợ', icon: Users, shortcut: 'Alt + C' },
    { screen: 'suppliers', label: 'Nhà cung cấp & Đơn mua', icon: Truck, shortcut: 'Alt + K' },
    { screen: 'projects', label: 'Dự án & Thi công Công trình', icon: Building2, shortcut: 'Alt + J' },
    { screen: 'hr', label: 'Quản lý nhân sự', icon: UserCheck, shortcut: 'Alt + T' },
    { screen: 'cashbook', label: 'Sổ quỹ Thu - Chi', icon: Wallet, shortcut: 'Alt + Q' },
    ...(!isRestricted
      ? [{ screen: 'reports' as const, label: 'Báo cáo Doanh thu & Lãi-Lỗ', icon: BarChart3, shortcut: 'Alt + R' }]
      : []),
    ...(canAccessSettings
      ? [{ screen: 'settings' as const, label: 'Cài đặt cửa hàng', icon: Settings, shortcut: 'Alt + S' }]
      : []),
  ];

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && flyoutMenuOpen) {
        setFlyoutMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flyoutMenuOpen, setFlyoutMenuOpen]);

  if (!flyoutMenuOpen) return null;

  return (
    <div
      id="flyout-overlay"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-start justify-start transition-opacity"
      onClick={() => setFlyoutMenuOpen(false)}
    >
      <div
        id="flyout-menu-container"
        className="w-80 max-w-[90vw] h-full bg-white shadow-2xl border-r border-slate-200 flex flex-col animate-in slide-in-from-left duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-sm tracking-wide">MENU ĐIỀU HƯỚNG</span>
          </div>
          <button
            id="close-flyout-btn"
            onClick={() => setFlyoutMenuOpen(false)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Đóng menu (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List of Modules */}
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              currentScreen === item.screen ||
              (item.screen === 'hr' && ['hr', 'attendance', 'payroll'].includes(currentScreen));
            return (
              <button
                key={item.screen}
                id={`menu-item-${item.screen}`}
                onClick={() => {
                  setCurrentScreen(item.screen);
                  setFlyoutMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {item.badge && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded">
                      {item.badge}
                    </span>
                  )}
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 border border-slate-200 rounded text-slate-500">
                    {item.shortcut}
                  </kbd>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer: Shift & Logout */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2">
          <button
            id="menu-item-close-shift"
            onClick={() => {
              setFlyoutMenuOpen(false);
              setShiftModalOpen(true);
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <LogOut className="w-4 h-4 text-amber-600" />
              <span>Đóng ca làm việc / Đếm két</span>
            </div>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-amber-100 border border-amber-200 rounded text-amber-800">
              F12
            </kbd>
          </button>
          <div className="text-[11px] text-center text-slate-400 font-mono">
            Phiên bản SRS v2.12 Master Integrated
          </div>
        </div>
      </div>
    </div>
  );
}
