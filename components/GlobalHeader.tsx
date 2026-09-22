'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import {
  Menu,
  Wifi,
  WifiOff,
  Building2,
  User,
  Settings,
  Maximize,
  Minimize,
  ShoppingCart,
  Clock,
} from 'lucide-react';

const ROLE_LABEL_HEADER: Record<string, string> = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  worker: 'Thợ',
};

export function GlobalHeader() {
  const {
    flyoutMenuOpen,
    setFlyoutMenuOpen,
    isOnline,
    setIsOnline,
    pendingQueue,
    syncPendingOrders,
    branchName,
    currentScreen,
    setCurrentScreen,
    setShiftModalOpen,
    dimensionModalItem,
    receiptModalOrder,
    user,
    profile,
    setLoginOpen,
    currentShift,
  } = useStore();

  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Global Keyboard Shortcuts (F1, F11, F12, Alt + *)
  // (Tìm kiếm/SL đã chuyển xuống ProductSearchBar; F1 focus qua id)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const restricted = profile?.role === 'cashier' || profile?.role === 'worker';
      // Cài đặt: Admin toàn quyền + Manager quản lý NV (cấu hình hệ thống vẫn khóa trong view).
      const canAccessSettings = profile?.role === 'admin' || profile?.role === 'manager';
      const blockRestricted = () => {
        alert('Tài khoản thu ngân không có quyền vào phân hệ này!');
        return;
      };
      const blockNotAdmin = () => {
        alert('Chỉ Admin/Quản lý được vào Cài đặt (Quản lý chỉ quản lý nhân viên, cấu hình hệ thống vẫn chỉ Admin)!');
        return;
      };
      // F1: Focus Search Input (ở topbar danh sách hàng hóa)
      if (e.key === 'F1') {
        e.preventDefault();
        const el = document.getElementById('f1-search-input') as HTMLInputElement | null;
        el?.focus();
        el?.select();
        return;
      }

      // Alt + M: Toggle Flyout Menu
      if (e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setFlyoutMenuOpen((prev) => !prev);
        return;
      }

      // Alt + H: Orders
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setCurrentScreen('orders');
        return;
      }

      // Alt + P: Products
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setCurrentScreen('products');
        return;
      }

      // Alt + N: Inventory
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        if (restricted) {
          blockRestricted();
          return;
        }
        setCurrentScreen('inventory');
        return;
      }

      // Alt + C: Customers
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        setCurrentScreen('customers');
        return;
      }

      // Alt + K: Suppliers
      if (e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCurrentScreen('suppliers');
        return;
      }

      // Alt + J: Projects
      if (e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setCurrentScreen('projects');
        return;
      }

      // Alt + T: Attendance (chấm công thợ) — thu ngân/worker bị chặn
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        if (restricted) {
          blockRestricted();
          return;
        }
        setCurrentScreen('attendance');
        return;
      }

      // Alt + G: Bảng lương — thu ngân/worker bị chặn
      if (e.altKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (restricted) {
          blockRestricted();
          return;
        }
        setCurrentScreen('payroll');
        return;
      }

      // Alt + Q: Cashbook
      if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        setCurrentScreen('cashbook');
        return;
      }

      // Alt + R: Reports
      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (restricted) {
          blockRestricted();
          return;
        }
        setCurrentScreen('reports');
        return;
      }

      // Alt + S: Settings
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!canAccessSettings) {
          blockNotAdmin();
          return;
        }
        setCurrentScreen('settings');
        return;
      }

      // F11: Fullscreen Mode
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      // F12: Shift Modal (bỏ qua khi modal F3/receipt đang mở để tránh chồng modal)
      if (e.key === 'F12') {
        e.preventDefault();
        if (dimensionModalItem === null && receiptModalOrder === null) setShiftModalOpen(true);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setFlyoutMenuOpen, setCurrentScreen, setShiftModalOpen, toggleFullscreen, dimensionModalItem, receiptModalOrder, profile]);

  return (
    <header
      id="global-header"
      className="w-full h-14 bg-slate-900 text-white z-40 px-2 sm:px-3 border-b border-slate-800 flex items-center justify-between select-none shadow-md shrink-0"
    >
      {/* LEFT: Menu Button & Logo */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          id="flyout-menu-trigger"
          onClick={() => setFlyoutMenuOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
            flyoutMenuOpen
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
          }`}
          title="Mở menu phân hệ (Alt + M)"
        >
          <Menu className="w-4 h-4 text-emerald-400" />
          <span className="hidden sm:inline">Menu</span>
          <kbd className="hidden md:inline px-1 py-0.5 text-[9px] bg-slate-900/60 rounded text-slate-300 font-mono">
            Alt+M
          </kbd>
        </button>

        <div
          id="app-branding"
          onClick={() => setCurrentScreen('pos')}
          className="flex items-center gap-2 cursor-pointer group"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-xs">
            M
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5 leading-none">
              MultiPOS
              <span className="text-[10px] font-semibold px-1 py-0.2 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded">
                v2.12
              </span>
            </span>
            <span className="text-[10px] text-slate-400 hidden lg:inline">
              Bán lẻ & Thi công Nhôm kính
            </span>
          </div>
        </div>
      </div>

      {/* CENTER: bỏ dãy tab phân hệ — chuyển màn hình bằng Menu (Alt+M) / phím tắt */}
      <div className="flex-1" />

      {/* RIGHT: Status, Branch, Shift, Actions — cuộn ngang trên màn hẹp, không vỡ layout */}
      <div className="flex items-center gap-1.5 sm:gap-2 ml-2 min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
        {/* Đồng bộ đơn offline — đứng đầu dãy nút, giữ sẵn chỗ cố định nên hiện/ẩn không xô nút khác */}
        <span className="inline-flex w-8 items-center justify-center" aria-live="polite">
          {pendingQueue.length > 0 ? (
            <button
              id="pending-queue-badge"
              onClick={() => syncPendingOrders()}
              className="min-w-6 px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-slate-900 rounded-full hover:bg-amber-400 text-center transition-colors"
              title={`${pendingQueue.length} đơn hàng chưa đồng bộ (Click để sync)`}
            >
              {pendingQueue.length}
            </button>
          ) : (
            <span className="w-6" aria-hidden="true" />
          )}
        </span>
        {/* If on management screen, show BÁN HÀNG button — cùng height với các nút header khác */}
        {currentScreen !== 'pos' && (
          <button
            id="btn-goto-pos"
            onClick={() => setCurrentScreen('pos')}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-600 rounded-md text-[11px] font-bold transition-all shrink-0"
            title="Vào màn hình Bán hàng (F2)"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>BÁN HÀNG</span>
            <kbd className="px-1 text-[9px] font-mono bg-emerald-800 text-emerald-100 rounded">F2</kbd>
          </button>
        )}

        {/* If on POS screen: không còn nút Quản lý riêng — dùng Menu (Alt+M) để chuyển phân hệ */}

        {/* Offline / Online Toggle */}
        <div className="flex items-center">
          <button
            id="network-status-toggle"
            onClick={() => setIsOnline(!isOnline)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              isOnline
                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 hover:bg-emerald-900'
                : 'bg-rose-950/90 text-rose-300 border border-rose-700 animate-pulse'
            }`}
            title={isOnline ? 'Đang Online (Click để giả lập mất mạng)' : 'Đang Ngoại tuyến (Click để khôi phục kết nối)'}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isOnline ? 'Online' : 'Offline'}</span>
          </button>
        </div>

        {/* Branch selector */}
        <div
          id="branch-badge"
          className="hidden md:flex items-center gap-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded-md text-[11px] text-slate-300"
          title="Chi nhánh đang làm việc"
        >
          <Building2 className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate max-w-[120px]">{branchName}</span>
        </div>

        {/* Shift button — CHỈ hiện trạng thái ca, không hiện tên user (tránh trùng với nút user) */}
        <button
          id="header-shift-btn"
          onClick={() => setShiftModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-[11px] text-slate-200 transition-colors"
          title={`Kiểm đếm két / Đóng ca (F12) — ${currentShift.status === 'open' ? `Ca đang mở từ ${new Date(currentShift.opened_at).toLocaleString('vi-VN')}` : 'Ca đã đóng'}`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className={`hidden lg:inline font-semibold ${currentShift.status === 'open' ? 'text-emerald-300' : 'text-slate-400'}`}>
            {currentShift.status === 'open' ? 'Ca mở' : 'Ca đóng'}
          </span>
          <kbd className="px-1 text-[9px] font-mono bg-slate-900 text-amber-400 border border-amber-400/30 rounded">
            F12
          </kbd>
        </button>

        {/* P6: Auth — nút user mở thẻ phiên trong LoginModal (đổi TK / đăng xuất), khỏi confirm thô */}
        {user ? (
          <button
            id="header-user-btn"
            onClick={() => setLoginOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 rounded-md text-[11px] text-emerald-300 transition-colors"
            title={`${profile?.full_name || user.email} (${ROLE_LABEL_HEADER[profile?.role || ''] || profile?.role || '...'}) — Click để xem phiên / đổi tài khoản`}
          >
            <User className="w-3.5 h-3.5" />
            <span className="hidden lg:inline max-w-[140px] truncate">
              {profile?.full_name || user.email}
            </span>
            {profile?.role === 'admin' && (
              <span className="hidden xl:inline px-1 py-0.2 text-[9px] font-bold bg-emerald-800 text-emerald-100 rounded">
                Admin
              </span>
            )}
          </button>
        ) : (
          <button
            id="btn-header-login"
            onClick={() => setLoginOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-[11px] text-slate-200 transition-colors"
            title="Đăng nhập thu ngân / quản trị"
          >
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden lg:inline">Đăng nhập</span>
          </button>
        )}

        {/* Settings button */}
        <button
          id="header-settings-btn"
          onClick={() => {
            if (profile?.role !== 'admin' && profile?.role !== 'manager') {
              alert('Chỉ Admin/Quản lý được vào Cài đặt!');
              return;
            }
            setCurrentScreen('settings');
          }}
          className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-slate-300 transition-colors"
          title="Cài đặt hệ thống & nhân viên (Alt + S)"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Fullscreen toggle */}
        <button
          id="header-fullscreen-btn"
          onClick={toggleFullscreen}
          className="hidden sm:block p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-slate-300 transition-colors"
          title="Toàn màn hình (F11)"
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
}
