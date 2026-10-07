'use client';

import React, { useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { CustomersView } from '@/components/customers/CustomersView';
import { SuppliersView } from '@/components/suppliers/SuppliersView';
import { PageHeader } from '@/components/ui/PageHeader';
import { TabSwitcher } from '@/components/ui/TabSwitcher';
import { AppButton } from '@/components/ui/AppButton';

export type DebtsTab = 'customers' | 'suppliers';

// Trang Quản lý Công nợ: 1 header chung + 2 tab (thu nợ KH / trả nợ NCC).
// Nghiệp vụ thu/chi nằm nguyên trong từng view; shell chỉ gộp vỏ + nút thêm mới
// (modal mở qua prop). Mở cho mọi vai trò như 2 trang cũ (nút thu/chi tự chặn quyền).
export function DebtsView({ initialTab = 'customers' }: { initialTab?: DebtsTab }) {
  const [tab, setTab] = useState<DebtsTab>(initialTab);
  const [custAddOpen, setCustAddOpen] = useState(false);
  const [supAddOpen, setSupAddOpen] = useState(false);

  return (
    <div id="debts-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      <PageHeader
        icon={<Users className="w-5 h-5 text-blue-600" />}
        title="Quản lý Công nợ"
        shortTitle="Công nợ"
        actions={
          <>
            <TabSwitcher<DebtsTab>
              id="debts-tabs"
              active={tab}
              onChange={setTab}
              options={[
                { key: 'customers', label: 'Thu nợ khách hàng', id: 'debts-tab-customers' },
                { key: 'suppliers', label: 'Trả nợ NCC', id: 'debts-tab-suppliers' },
              ]}
            />
            {tab === 'customers' && (
              <AppButton className="min-w-44 justify-center" onClick={() => setCustAddOpen(true)}>
                <Plus className="w-4 h-4" />
                <span>Thêm khách hàng mới</span>
              </AppButton>
            )}
            {tab === 'suppliers' && (
              <AppButton id="btn-add-supplier" className="min-w-44 justify-center" onClick={() => setSupAddOpen(true)}>
                <Plus className="w-4 h-4" />
                <span>Thêm NCC mới</span>
              </AppButton>
            )}
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === 'customers' && (
          <CustomersView bare addOpen={custAddOpen} onAddOpenChange={setCustAddOpen} />
        )}
        {tab === 'suppliers' && (
          <SuppliersView bare addOpen={supAddOpen} onAddOpenChange={setSupAddOpen} />
        )}
      </div>
    </div>
  );
}
