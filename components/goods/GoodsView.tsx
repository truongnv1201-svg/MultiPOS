'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { Boxes, Plus, Scale } from 'lucide-react';
import { ProductsView } from '@/components/products/ProductsView';
import { InventoryView } from '@/components/inventory/InventoryView';
import { PageHeader } from '@/components/ui/PageHeader';
import { TabSwitcher } from '@/components/ui/TabSwitcher';
import { AppButton } from '@/components/ui/AppButton';

export type GoodsTab = 'catalog' | 'movements';

// Trang Quản lý Hàng hóa: 1 header chung (giống trang Chứng từ) + 2 tab.
// Inner view chạy bare (ẩn header, TableTools xuống thanh filter); nút tạo mở
// modal của inner view qua prop điều khiển. Thẻ kho ẩn với thu ngân/worker.
export function GoodsView({ initialTab = 'catalog' }: { initialTab?: GoodsTab }) {
  const { profile, setCurrentScreen, setPosFlow } = useStore();
  const [tab, setTab] = useState<GoodsTab>(initialTab);
  const [addOpen, setAddOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const isRestricted = profile?.role === 'cashier' || profile?.role === 'worker';
  const activeTab: GoodsTab = isRestricted ? 'catalog' : tab;
  const canAdjust = !profile || profile.role === 'admin' || profile.role === 'manager';

  return (
    <div id="goods-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      <PageHeader
        icon={<Boxes className="w-5 h-5 text-blue-600" />}
        title="Quản lý Hàng hóa"
        shortTitle="Hàng hóa"
        actions={
          <>
            <TabSwitcher<GoodsTab>
              id="goods-tabs"
              active={activeTab}
              onChange={setTab}
              options={
                isRestricted
                  ? [{ key: 'catalog', label: 'Danh mục & Bảng giá', id: 'goods-tab-catalog' }]
                  : [
                      { key: 'catalog', label: 'Danh mục & Bảng giá', id: 'goods-tab-catalog' },
                      { key: 'movements', label: 'Thẻ kho', id: 'goods-tab-movements' },
                    ]
              }
            />
            {activeTab === 'catalog' && (
              <AppButton id="btn-open-add-product-modal" className="min-w-56 justify-center" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4" />
                <span>Thêm hàng hóa mới</span>
              </AppButton>
            )}
            {activeTab === 'movements' && (
              <>
                <AppButton
                  id="btn-stock-adjust-open"
                  className="min-w-56 justify-center"
                  tone="amber"
                  onClick={() => setAdjustOpen(true)}
                  disabled={!canAdjust}
                  title={
                    canAdjust
                      ? 'Điều chỉnh tồn kho khi hao hụt, hết hạn, thất lạc hoặc đếm sai (có ghi thẻ kho + lý do)'
                      : 'Chỉ Admin/Quản lý được điều chỉnh tồn kho'
                  }
                >
                  <Scale className="w-4 h-4" />
                  <span>Điều chỉnh tồn</span>
                </AppButton>
                <AppButton
                  className="min-w-56 justify-center"
                  onClick={() => {
                    setPosFlow('import');
                    setCurrentScreen('pos');
                  }}
                  title="Sang màn bán hàng ở chế độ nhập kho"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tạo Phiếu Nhập Kho (PN)</span>
                </AppButton>
              </>
            )}
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'catalog' && <ProductsView bare addOpen={addOpen} onAddOpenChange={setAddOpen} />}
        {activeTab === 'movements' && (
          <InventoryView bare adjustOpen={adjustOpen} onAdjustOpenChange={setAdjustOpen} />
        )}
      </div>
    </div>
  );
}
