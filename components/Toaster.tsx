'use client';

import React, { useSyncExternalStore, useState, useEffect } from 'react';
import {
  subscribeNotify,
  getNotifySnapshot,
  resolveDialog,
  type DialogRequest,
} from '@/lib/notify';

const TOAST_STYLE: Record<string, string> = {
  info: 'bg-slate-900 text-white',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

function DialogModal({ dialog }: { dialog: DialogRequest }) {
  const [value, setValue] = useState(dialog.defaultValue ?? '');
  const cancel = () => resolveDialog(dialog.id, dialog.kind === 'prompt' ? null : false);
  const submit = () => resolveDialog(dialog.id, dialog.kind === 'prompt' ? value : true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && dialog.kind === 'prompt') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog.id, value]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={cancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="whitespace-pre-line text-sm text-slate-800">{dialog.message}</p>
        {dialog.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={cancel}
            className="rounded px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            {dialog.cancelLabel || 'Hủy'}
          </button>
          <button
            onClick={submit}
            className={`rounded px-4 py-2 text-sm text-white ${
              dialog.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'
            }`}
          >
            {dialog.okLabel || 'Đồng ý'}
          </button>
        </div>
      </div>
    </div>
  );
}

const SERVER_SNAPSHOT = { toasts: [], dialogs: [] };

export function Toaster() {
  const { toasts, dialogs } = useSyncExternalStore(
    subscribeNotify,
    getNotifySnapshot,
    () => SERVER_SNAPSHOT
  );
  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm shadow-lg ${TOAST_STYLE[t.kind]}`}>
            <span className="whitespace-pre-line">{t.message}</span>
          </div>
        ))}
      </div>
      {dialogs.length > 0 && <DialogModal key={dialogs[0].id} dialog={dialogs[0]} />}
    </>
  );
}
