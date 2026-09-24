// P3: modal thêm nhanh KH từ POS (tách từ POSScreen.tsx — tự gọi useStore, state nội bộ).
'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { notify } from '@/components/common/Toast';
import { User, X } from 'lucide-react';

export function POSQuickCustomerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addCustomer, updateActiveTab } = useStore();
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');
  const [newCustGroup, setNewCustGroup] = useState<'retail' | 'contractor' | 'wholesale'>('retail');

  const handleSaveQuickCustomer = async () => {
    if (!newCustName.trim() || !newCustPhone.trim()) {
      notify('Vui lòng nhập họ tên và số điện thoại khách hàng', 'error');
      return;
    }
    const newCust = await addCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      group: newCustGroup,
      address: 'Tại quầy',
      current_debt: 0,
      debt_limit: newCustGroup === 'contractor' ? 50000000 : 10000000,
    });
    updateActiveTab({
      customer_id: newCust.id,
      customer_name: newCust.name,
      customer_phone: newCust.phone,
    });
    onClose();
    setNewCustName('');
    setNewCustPhone('');
  };

  if (!open) return null;
  return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in-50 zoom-in-95">
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-sm">
              <User className="w-4 h-4 text-blue-400" />
              <span>Thêm nhanh khách hàng mới</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Họ và tên khách hàng <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                placeholder="Ví dụ: Anh Dũng Nhôm Kính"
                className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
                autoFocus
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Số điện thoại <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                placeholder="0988..."
                className="w-full h-8 px-2.5 font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Nhóm khách hàng:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setNewCustGroup('retail')}
                  className={`p-2 rounded-lg border text-center font-semibold transition-all ${
                    newCustGroup === 'retail'
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  Khách lẻ
                  <div className="text-[10px] font-normal text-slate-400">Cá nhân mua lẻ</div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewCustGroup('contractor')}
                  className={`p-2 rounded-lg border text-center font-semibold transition-all ${
                    newCustGroup === 'contractor'
                      ? 'border-amber-600 bg-amber-50 text-amber-800'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  Thợ công trình
                  <div className="text-[10px] font-normal text-slate-400">Thợ / nhà thầu</div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewCustGroup('wholesale')}
                  className={`p-2 rounded-lg border text-center font-semibold transition-all ${
                    newCustGroup === 'wholesale'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  Đại lý cấp 1
                  <div className="text-[10px] font-normal text-slate-400">Cửa hàng / đại lý</div>
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-md text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              id="btn-confirm-save-quick-customer"
              onClick={handleSaveQuickCustomer}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold shadow-xs"
            >
              Lưu & Chọn khách
            </button>
          </div>
        </div>
      </div>
  );
}
