'use client';

import React, { useEffect, useRef } from 'react';
import { StoreProvider, useStore } from '@/lib/store';
import type { ActiveScreen } from '@/lib/types';
import { GlobalHeader } from '@/components/GlobalHeader';
import { FlyoutMenu } from '@/components/FlyoutMenu';
import { POSScreen } from '@/components/pos/POSScreen';
import { DimensionModalF3 } from '@/components/pos/DimensionModalF3';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { ShiftModalF12 } from '@/components/pos/ShiftModalF12';
import { OrdersView } from '@/components/orders/OrdersView';
import { ProductsView } from '@/components/products/ProductsView';
import { InventoryView } from '@/components/inventory/InventoryView';
import { CustomersView } from '@/components/customers/CustomersView';
import { SuppliersView } from '@/components/suppliers/SuppliersView';
import { ProjectsView } from '@/components/projects/ProjectsView';
import { HRMView } from '@/components/hrm/HRMView';
import { CashbookView } from '@/components/cashbook/CashbookView';
import { ReportsView } from '@/components/reports/ReportsView';
import { SettingsView } from '@/components/settings/SettingsView';
import { LoginModal } from '@/components/auth/LoginModal';
import { ConfirmDialogHost } from '@/components/common/ConfirmDialog';
import { ToastHost } from '@/components/common/Toast';

// Màn hình hạ cánh sau đăng nhập: mọi vai trò đều vào Bán hàng (POS).
// (Không export: file page của Next.js chỉ được export default + các named chuẩn).
function roleHomeScreen(_role?: string): ActiveScreen {
  return 'pos';
}

function Splash() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-slate-900 text-white">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-2xl shadow-lg">
        M
      </div>
      <div className="font-bold text-lg tracking-tight">MultiPOS</div>
      <div className="text-xs text-slate-400">Đang tải phiên làm việc...</div>
    </div>
  );
}

function AppContent() {
  const {
    currentScreen,
    setCurrentScreen,
    user,
    profile,
    authReady,
    supabaseReady,
    loginOpen,
    setLoginOpen,
  } = useStore();

  // Cổng bắt buộc: đã cấu hình Supabase + xác thực xong mà chưa login -> chặn toàn app.
  // Chế độ local-only (chưa cấu hình env) không có backend tài khoản nên vào thẳng demo.
  const needGate = supabaseReady && authReady && !user;

  // Cổng hiện thì form login phải mở (defer microtask để khỏi set-state-in-effect)
  useEffect(() => {
    if (needGate && !loginOpen) Promise.resolve().then(() => setLoginOpen(true));
  }, [needGate, loginOpen, setLoginOpen]);

  // Login xong (đủ profile vai trò) -> hạ cánh đúng màn hình của vai trò, 1 lần/phiên
  const landedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !profile || landedFor.current === user.id) return;
    landedFor.current = user.id;
    const home = roleHomeScreen(profile.role);
    Promise.resolve().then(() => setCurrentScreen(home));
  }, [user, profile, setCurrentScreen]);

  if (!authReady) {
    return (
      <div className="flex flex-col h-dvh bg-slate-100 font-sans select-none antialiased overflow-hidden">
        <Splash />
      </div>
    );
  }

  if (needGate) {
    return (
      <div className="flex flex-col h-dvh bg-slate-100 font-sans select-none antialiased overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-slate-900 via-slate-900 to-blue-950 text-white px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center font-bold text-3xl shadow-xl">
            M
          </div>
          <div className="font-bold text-xl tracking-tight">MultiPOS</div>
          <div className="text-xs text-slate-300 max-w-xs leading-relaxed">
            Vui lòng đăng nhập bằng mã nhân viên để vào ca làm việc. Đăng nhập xong vào ngay màn hình Bán hàng.
          </div>
        </div>
        <LoginModal locked />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-slate-100 font-sans select-none antialiased overflow-hidden">
      {/* Global Header with Navigation & Shortcut listeners */}
      <GlobalHeader />

      {/* Flyout Navigation Menu (Alt + M) */}
      <FlyoutMenu />

      {/* Dynamic Screen View */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {currentScreen === 'pos' && <POSScreen />}
        {currentScreen === 'orders' && <OrdersView />}
        {currentScreen === 'products' && <ProductsView />}
        {currentScreen === 'inventory' && <InventoryView />}
        {currentScreen === 'customers' && <CustomersView />}
        {currentScreen === 'suppliers' && <SuppliersView />}
        {currentScreen === 'projects' && <ProjectsView />}
        {(currentScreen === 'hr' || currentScreen === 'attendance' || currentScreen === 'leave' || currentScreen === 'payroll') && <HRMView />}
        {currentScreen === 'cashbook' && <CashbookView />}
        {currentScreen === 'reports' && <ReportsView />}
        {currentScreen === 'settings' && <SettingsView />}
      </main>

      {/* Global Modals */}
      <DimensionModalF3 />
      <ReceiptModal />
      <ShiftModalF12 />
      <LoginModal />
    </div>
  );
}

export default function Home() {
  return (
    <StoreProvider>
      <AppContent />
      <ConfirmDialogHost />
      <ToastHost />
    </StoreProvider>
  );
}
