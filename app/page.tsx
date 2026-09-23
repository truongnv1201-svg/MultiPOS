'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { StoreProvider, useStore } from '@/lib/store';
import { GlobalHeader } from '@/components/GlobalHeader';
import { FlyoutMenu } from '@/components/FlyoutMenu';
import { POSScreen } from '@/components/pos/POSScreen';
import { DimensionModalF3 } from '@/components/pos/DimensionModalF3';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { ShiftModalF12 } from '@/components/pos/ShiftModalF12';
import { LoginModal } from '@/components/auth/LoginModal';
import { Toaster } from '@/components/Toaster';

// P2: POS + modal bán hàng giữ import tĩnh (màn hình chính, cần hiện ngay).
// 10 phân hệ còn lại lazy-load theo màn hình để bundle đầu nhẹ.
const OrdersView = dynamic(() =>
  import('@/components/orders/OrdersView').then((m) => m.OrdersView)
);
const ProductsView = dynamic(() =>
  import('@/components/products/ProductsView').then((m) => m.ProductsView)
);
const InventoryView = dynamic(() =>
  import('@/components/inventory/InventoryView').then((m) => m.InventoryView)
);
const CustomersView = dynamic(() =>
  import('@/components/customers/CustomersView').then((m) => m.CustomersView)
);
const SuppliersView = dynamic(() =>
  import('@/components/suppliers/SuppliersView').then((m) => m.SuppliersView)
);
const ProjectsView = dynamic(() =>
  import('@/components/projects/ProjectsView').then((m) => m.ProjectsView)
);
const HRMView = dynamic(() => import('@/components/hrm/HRMView').then((m) => m.HRMView));
const CashbookView = dynamic(() =>
  import('@/components/cashbook/CashbookView').then((m) => m.CashbookView)
);
const ReportsView = dynamic(() =>
  import('@/components/reports/ReportsView').then((m) => m.ReportsView)
);
const SettingsView = dynamic(() =>
  import('@/components/settings/SettingsView').then((m) => m.SettingsView)
);

function AppContent() {
  const { currentScreen } = useStore();

  return (
    <div className="flex flex-col h-screen bg-slate-100 font-sans select-none antialiased overflow-hidden">
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
      {/* P2: toast + confirm/prompt non-blocking */}
      <Toaster />
    </div>
  );
}

export default function Home() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}
