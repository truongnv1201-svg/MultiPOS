'use client';

import React, { useEffect, useRef } from 'react';
import { StoreProvider, useStore } from '@/lib/store';
import type { ActiveScreen } from '@/lib/types';
import { GlobalHeader } from '@/components/GlobalHeader';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { FlyoutMenu } from '@/components/FlyoutMenu';
import { POSScreen } from '@/components/pos/POSScreen';
import { DimensionModalF3 } from '@/components/pos/DimensionModalF3';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { ShiftModalF12 } from '@/components/pos/ShiftModalF12';
import { VouchersView } from '@/components/vouchers/VouchersView';
import { GoodsView } from '@/components/goods/GoodsView';
import { DebtsView } from '@/components/debts/DebtsView';
import { ProjectsView } from '@/components/projects/ProjectsView';
import { HRMView } from '@/components/hrm/HRMView';
import { CashbookView } from '@/components/cashbook/CashbookView';
import { ReportsView } from '@/components/reports/ReportsView';
import { SettingsView } from '@/components/settings/SettingsView';
import { LoginModal } from '@/components/auth/LoginModal';
import { ConfirmDialogHost } from '@/components/common/ConfirmDialog';
import { ToastHost } from '@/components/common/Toast';
import { useIsPhone } from '@/hooks/useIsPhone';

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

  // Điện thoại (< 768px) chỉ dùng màn POS: không bottom nav, không menu phân hệ,
  // mở app (kể cả restore màn hình cũ / shortcut ?screen=) cũng hạ cánh về POS.
  const isPhone = useIsPhone();
  const effectiveScreen = isPhone ? 'pos' : currentScreen;

  // Cổng hiện thì form login phải mở (defer microtask để khỏi set-state-in-effect)
  useEffect(() => {
    if (needGate && !loginOpen) Promise.resolve().then(() => setLoginOpen(true));
  }, [needGate, loginOpen, setLoginOpen]);

  // Login xong (đủ profile vai trò) -> hạ cánh đúng màn hình của vai trò, 1 lần/phiên
  const landedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !profile || landedFor.current === user.id) return;
    // Chỉ redirect lần đầu đăng nhập, không khi reload (đã restore từ localStorage)
    const restored = typeof window !== 'undefined' ? localStorage.getItem('multipos_last_screen') : null;
    if (restored) return; // đã có màn hình lưu -> không ép về POS
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

      {/* Dynamic Screen View (điện thoại khóa về POS) */}
      <main className={`flex-1 flex flex-col min-h-0 overflow-hidden ${effectiveScreen === 'pos' ? '' : 'mobile-main-bottom-space'}`}>
        {effectiveScreen === 'pos' && <POSScreen />}
        {effectiveScreen === 'vouchers' && <VouchersView />}
        {/* Key cũ (menu lưu localStorage, shortcut Alt+H/D): mở Chứng từ đúng tab */}
        {effectiveScreen === 'orders' && <VouchersView initialTab="sales" />}
        {effectiveScreen === 'imports' && <VouchersView initialTab="imports" />}
        {effectiveScreen === 'goods' && <GoodsView />}
        {/* Key cũ (Alt+P/N): mở Hàng hóa đúng tab */}
        {effectiveScreen === 'products' && <GoodsView initialTab="catalog" />}
        {effectiveScreen === 'inventory' && <GoodsView initialTab="movements" />}
        {effectiveScreen === 'debts' && <DebtsView />}
        {/* Key cũ (menu lưu localStorage, Alt+C/K): mở Công nợ đúng tab */}
        {effectiveScreen === 'customers' && <DebtsView initialTab="customers" />}
        {effectiveScreen === 'suppliers' && <DebtsView initialTab="suppliers" />}
        {effectiveScreen === 'projects' && <ProjectsView />}
        {(effectiveScreen === 'hr' || effectiveScreen === 'attendance' || effectiveScreen === 'leave' || effectiveScreen === 'payroll') && <HRMView />}
        {effectiveScreen === 'cashbook' && <CashbookView />}
        {effectiveScreen === 'reports' && <ReportsView />}
        {effectiveScreen === 'settings' && <SettingsView />}
      </main>

      {!isPhone && <MobileBottomNav />}

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
