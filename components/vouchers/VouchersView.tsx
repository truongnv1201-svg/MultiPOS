'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { OrdersView } from '@/components/orders/OrdersView';
import { ImportsView } from '@/components/imports/ImportsView';
import { ExportsTab } from '@/components/vouchers/ExportsTab';
import { StockAdjustTable } from '@/components/inventory/StockAdjustTable';
import { StockAdjustModal } from '@/components/inventory/StockAdjustModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { TabSwitcher } from '@/components/ui/TabSwitcher';
import { AppButton } from '@/components/ui/AppButton';
import { ReceiptText, Plus, Building2, ClipboardCheck } from 'lucide-react';

export type VoucherTab = 'sales' | 'imports' | 'exports' | 'adjust';

// Trang Quản lý Chứng từ: 4 tab lịch sử theo phiếu (trục chứng từ), bổ sung cho
// Thẻ kho vốn xem theo mặt hàng. Mỗi tab là 1 view độc lập (lazy-mount để khỏi
// double-subscribe store); inner view chạy bare (h-full) dưới shell.
export function VouchersView({ initialTab = 'sales' }: { initialTab?: VoucherTab }) {
  const { setCurrentScreen, setPosFlow, profile } = useStore();
  const [tab, setTab] = useState<VoucherTab>(initialTab);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const canAdjust = !profile || profile.role === 'admin' || profile.role === 'manager';
  // Thu ngân/worker trước đây chỉ được xem Đơn bán (Đơn nhập/Xuất CT/Điều chỉnh ẩn
  // theo menu + shortcut) — giữ nguyên quyền trong trang gộp.
  const isRestricted = profile?.role === 'cashier' || profile?.role === 'worker';
  const activeTab: VoucherTab = isRestricted ? 'sales' : tab;

  return (
    <div id="vouchers-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      <PageHeader
        icon={<ReceiptText className="w-5 h-5 text-blue-600" />}
        title="Quản lý Chứng từ"
        shortTitle="Chứng từ"
        actions={
          <>
            <TabSwitcher<VoucherTab>
              id="vouchers-tabs"
              active={activeTab}
              onChange={setTab}
              options={
                isRestricted
                  ? [{ key: 'sales', label: 'Đơn bán', id: 'vouchers-tab-sales' }]
                  : [
                      { key: 'sales', label: 'Đơn bán', id: 'vouchers-tab-sales' },
                      { key: 'imports', label: 'Đơn nhập', id: 'vouchers-tab-imports' },
                      { key: 'exports', label: 'Xuất CT', id: 'vouchers-tab-exports' },
                      { key: 'adjust', label: 'Điều chỉnh', id: 'vouchers-tab-adjust' },
                    ]
              }
            />
            {activeTab === 'sales' && (
              <AppButton onClick={() => setCurrentScreen('pos')}>
                <Plus className="w-4 h-4" />
                <span>Tạo đơn bán hàng (F2)</span>
              </AppButton>
            )}
            {activeTab === 'imports' && (
              <AppButton
                onClick={() => {
                  setPosFlow('import');
                  setCurrentScreen('pos');
                }}
              >
                <Plus className="w-4 h-4" />
                <span>Tạo phiếu nhập</span>
              </AppButton>
            )}
            {activeTab === 'exports' && (
              <AppButton onClick={() => setCurrentScreen('projects')}>
                <Building2 className="w-4 h-4" />
                <span>Mở công trình</span>
              </AppButton>
            )}
            {activeTab === 'adjust' && canAdjust && (
              <AppButton onClick={() => setAdjustOpen(true)}>
                <ClipboardCheck className="w-4 h-4" />
                <span>Điều chỉnh tồn</span>
              </AppButton>
            )}
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
        {activeTab === 'sales' && <OrdersView bare />}
        {activeTab === 'imports' && <ImportsView bare />}
        {activeTab === 'exports' && <ExportsTab />}
        {activeTab === 'adjust' && <StockAdjustTable />}
      </div>

      <StockAdjustModal open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </div>
  );
}
