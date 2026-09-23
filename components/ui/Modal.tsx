'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// Khung modal chung: overlay + Escape + nút X + tiêu đề + footer tùy chọn.
// Các modal nghiệp vụ (thu nợ, thêm KH, cọc...) bọc nội dung bằng Modal này để
// đồng nhất khung, focus và cách đóng. (Dialog xác nhận nhanh vẫn dùng confirmDialog.)
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl bg-card shadow-xl flex flex-col max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line shrink-0">
          <h3 className="text-sm font-bold text-ink truncate">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="ml-auto w-7 h-7 flex items-center justify-center rounded text-ink-soft hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 overflow-y-auto scroll-thin">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-line flex justify-end gap-2 shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}
