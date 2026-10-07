'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { Boxes } from 'lucide-react';
import { ProductsView } from '@/components/products/ProductsView';
import { InventoryView } from '@/components/inventory/InventoryView';
import { TabSwitcher } from '@/components/ui/TabSwitcher';

export type GoodsTab = 'catalog' | 'movements';

// Trang Quản lý Hàng hóa: 2 tab theo hàng hóa (trục mặt hàng), bổ sung cho trang
// Chứng từ vốn xem theo phiếu. Inner view giữ nguyên header + nút của nó;
// shell chỉ có dải tab gọn để khỏi trùng tiêu đề. Thẻ kho (lộ giá vốn MAC)
// ẩn với thu ngân/worker như trước đây.
export function GoodsView({ initialTab = 'catalog' }: { initialTab?: GoodsTab }) {
  const { profile } = useStore();
  const [tab, setTab] = useState<GoodsTab>(initialTab);
  const isRestricted = profile?.role === 'cashier' || profile?.role === 'worker';
  const activeTab: GoodsTab = isRestricted ? 'catalog' : tab;

  return (
    <div id="goods-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      <div className="h-12 px-2 sm:px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
          <Boxes className="w-5 h-5 text-blue-600" />
          <span>Quản lý Hàng hóa</span>
        </h2>
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
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'catalog' && <ProductsView />}
        {activeTab === 'movements' && <InventoryView />}
      </div>
    </div>
  );
}
