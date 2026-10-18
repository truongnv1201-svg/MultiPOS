'use client';

import React, { useState } from 'react';
import { AlertTriangle, X, PackagePlus, Info } from 'lucide-react';
import { STOCK_ADJUST_REASON_LABEL, type StockAdjustReason } from '@/lib/types';
import type { StockShortage } from '@/lib/stock-shortage';
import { FilterSelect } from '@/components/ui/FilterControls';
import { formatQty } from '@/lib/quantity';
import { notify } from '@/components/common/Toast';

// Cân tồn nhanh tại quầy: giỏ đang bán vượt tồn hệ thống -> Admin/Quản lý sinh phiếu
// điều chỉnh TĂNG tồn (0064) ngay trong POS rồi chạy lại thanh toán. Thay cho ngõ cụt
// "giảm SL hoặc nhập kho thêm" (phải thoát POS -> Kho -> điều chỉnh -> quay lại).
//
// Nguyên tắc giữ đúng nghiệp vụ 0064:
// - Chỉ TĂNG tồn đúng phần thiếu (delta = need - have). Không hạ tồn ở đây.
// - BẮT BUỘC user chọn lý do: máy KHÔNG tự chốt lý do (tự chốt là mất khả năng truy vết
//   và biến phiếu PQ thành nút "cân kho không cần biết vì sao").
// - Không đụng sổ quỹ / giá vốn (đã do adjustStock 0064 lo).
const REASON_OPTIONS = [
  { value: '', label: 'Chọn lý do điều chỉnh…' },
  ...Object.entries(STOCK_ADJUST_REASON_LABEL).map(([value, label]) => ({ value, label })),
];

const DEFAULT_NOTE = 'Cân tồn nhanh khi bán tại quầy';

interface StockShortageModalProps {
  open: boolean;
  shortages: StockShortage[];
  onClose: () => void;
  /** Trả về khi user xác nhận; component tự quản busy, đóng/mở do cha quyết định. */
  onConfirm: (reason: StockAdjustReason, note: string) => void | Promise<void>;
}

export default function StockShortageModal({ open, shortages, onClose, onConfirm }: StockShortageModalProps) {
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState<string>(DEFAULT_NOTE);
  const [busy, setBusy] = useState(false);

  // Mở modal -> reset lý do (không nhớ lần trước, tránh bấm nhầm lý do cũ) + note mặc định.
  // Pattern "adjust state during render" của repo (StockAdjustModal) thay vì setState trong effect.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setReason('');
      setNote(DEFAULT_NOTE);
    }
  }

  if (!open) return null;

  const handleSubmit = async () => {
    if (!reason) {
      notify('Hãy chọn lý do điều chỉnh trước khi cân tồn kho.', 'error');
      return;
    }
    if (shortages.length === 0) return;
    setBusy(true);
    try {
      await onConfirm(reason as StockAdjustReason, note.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cân tồn kho để bán tiếp"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm">
            <PackagePlus className="w-4 h-4 text-amber-400" />
            <span>Cân tồn kho để bán tiếp</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-white p-1 rounded disabled:opacity-50"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 sm:p-4 space-y-3 overflow-y-auto min-h-0">
          <div className="flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              Giỏ hàng vượt tồn hệ thống nên chưa thanh toán được. Cân tồn sẽ{' '}
              <strong>tăng tồn đúng phần thiếu</strong> bằng một phiếu điều chỉnh (PQ) có truy vết.
            </span>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
              Mặt hàng thiếu tồn
            </div>
            <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {shortages.map((s) => (
                <div key={s.productId} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-xs font-semibold text-slate-800 truncate">{s.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-500">{s.sku}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-600">
                    <span>
                      Tồn: <strong className="text-slate-800">{formatQty(s.have)}</strong>
                    </span>
                    <span>
                      Cần: <strong className="text-slate-800">{formatQty(s.need)}</strong>
                    </span>
                    <span className="font-semibold text-emerald-700">
                      Tăng: +{formatQty(s.short)} {s.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Lý do điều chỉnh <span className="text-rose-500">*</span>
              </label>
              <FilterSelect
                id="stock-shortage-reason"
                value={reason}
                onChange={setReason}
                options={REASON_OPTIONS}
                title="Chọn lý do điều chỉnh"
                className="w-full"
                disabled={busy}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Ghi chú <span className="font-normal text-slate-400">(sửa được)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
            <span>
              Nếu hàng này thực ra <strong>chưa lập phiếu nhập kho</strong>, hãy dùng luồng Nhập kho để ghi
              đúng giá vốn &amp; công nợ nhà cung cấp — điều chỉnh tồn chỉ cân lại số lượng, không ghi tiền.
            </span>
          </p>
        </div>

        <div className="px-3 sm:px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Giảm số lượng
          </button>
          <button
            type="button"
            id="btn-stock-shortage-confirm"
            onClick={handleSubmit}
            disabled={busy}
            className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <PackagePlus className="w-4 h-4" />
            {busy ? 'Đang cân tồn…' : 'Cân tồn & bán tiếp'}
          </button>
        </div>
      </div>
    </div>
  );
}
