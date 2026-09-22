'use client';

import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

// Hộp xác nhận trong app thay cho confirm() native của trình duyệt.
// Lý do: một số môi trường nhúng (applet/preview) chặn dialog native và ném lỗi
// "Command plugin:dialog|confirm not allowed by ACL".
// Cách dùng ở mọi nơi (kể cả store không phải component):
//   import { confirmDialog } from '@/components/common/ConfirmDialog';
//   if (!(await confirmDialog('...'))) return;
//   => true = Đồng ý, false = Hủy/đóng. Cần render <ConfirmDialogHost/> 1 lần ở app/page.

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Pending {
  message: string;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (v: boolean) => void;
}

let setHostState: React.Dispatch<React.SetStateAction<Pending | null>> | null = null;

export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!setHostState) {
      // Host chưa mount: không đoán bừa với hành động phá hủy -> coi như Hủy
      resolve(false);
      return;
    }
    setHostState({
      message,
      title: opts.title || 'Xác nhận',
      confirmLabel: opts.confirmLabel || 'Đồng ý',
      cancelLabel: opts.cancelLabel || 'Hủy bỏ',
      danger: opts.danger !== false,
      resolve,
    });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setHostState = setPending;
    return () => {
      if (setHostState === setPending) setHostState = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPending(null);
        pending.resolve(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  if (!pending) return null;

  const done = (v: boolean) => {
    setPending(null);
    pending.resolve(v);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-3"
      onClick={() => done(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title}
      >
        <div className="p-4 flex items-start gap-3">
          <span
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              pending.danger ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-slate-900">{pending.title}</h3>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed whitespace-pre-line">{pending.message}</p>
          </div>
        </div>
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={() => done(false)}
            className="px-3.5 h-9 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl transition-colors"
          >
            {pending.cancelLabel}
          </button>
          <button
            onClick={() => done(true)}
            autoFocus
            className={`px-3.5 h-9 text-white text-xs font-bold rounded-xl transition-colors ${
              pending.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
