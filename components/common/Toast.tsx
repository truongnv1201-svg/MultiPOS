'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Toast nhẹ trong app thay cho alert() sau các thao tác thành công.
// Cách dùng ở mọi nơi (kể cả store không phải component):
//   import { notify } from '@/components/common/Toast';
//   notify('Thanh toán thành công!', 'success');
// Cần render <ToastHost/> 1 lần ở app/page (cạnh ConfirmDialogHost).

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let pushToast: ((message: string, type: ToastType) => void) | null = null;
let toastSeq = 0;

const DURATION_MS = 4000;

export function notify(message: string, type: ToastType = 'success') {
  if (pushToast) {
    pushToast(message, type);
    return;
  }
  // Host chưa mount (rất hiếm): fallback alert để không mất thông báo
  alert(message);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    pushToast = (message, type) => {
      const id = ++toastSeq;
      setItems((prev) => [...prev.slice(-2), { id, message, type }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    };
    return () => {
      if (pushToast) pushToast = null;
    };
  }, [dismiss]);

  if (items.length === 0) return null;

  const style: Record<ToastType, { box: string; icon: React.ReactNode }> = {
    success: {
      box: 'bg-emerald-600 text-white border-emerald-700',
      icon: <CheckCircle2 className="w-5 h-5 shrink-0" />,
    },
    error: {
      box: 'bg-rose-600 text-white border-rose-700',
      icon: <AlertCircle className="w-5 h-5 shrink-0" />,
    },
    info: {
      box: 'bg-slate-900 text-white border-slate-700',
      icon: <Info className="w-5 h-5 shrink-0" />,
    },
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-sm flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-xl border shadow-2xl text-xs font-semibold text-left animate-in slide-in-from-right-5 fade-in duration-200 ${style[t.type].box}`}
        >
          {style[t.type].icon}
          <span className="flex-1 whitespace-pre-line">{t.message}</span>
          <X className="w-3.5 h-3.5 opacity-70 shrink-0" />
        </button>
      ))}
    </div>
  );
}
