'use client';

import { useEffect, useState, useCallback } from 'react';

// Đăng ký service worker (chỉ production để tránh cache bẩn khi dev).
// Phát hiện bản mới: SW mới install xong (updatefound) + chủ động update() mỗi
// 30 phút cho tab POS mở lâu không điều hướng. KHÔNG tự reload (kẻo mất giỏ
// hàng đang bán) — hiện banner để user chủ động tải lại lúc rảnh.
export function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    let timer: number | null = null;
    let cancelled = false;
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        const watch = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (!cancelled && worker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        };
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        // Tab mở lâu không điều hướng: chủ động hỏi bản mới mỗi 30 phút
        timer = window.setInterval(() => {
          reg.update().catch(() => {});
        }, 30 * 60 * 1000);
      })
      .catch((err) => {
        console.warn('[pwa] SW register failed:', err);
      });
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  const reloadNow = useCallback(() => {
    window.location.reload();
  }, []);

  const dismiss = useCallback(() => {
    setUpdateReady(false);
  }, []);

  if (!updateReady) return null;
  return (
    <div
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 pl-3 pr-2 py-2 bg-slate-900 text-white text-xs rounded-xl shadow-2xl border border-slate-700"
      role="status"
    >
      <span className="font-semibold whitespace-nowrap">Có bản mới — tải lại để nhận sửa lỗi.</span>
      <button
        onClick={reloadNow}
        className="px-3 py-1.5 font-bold bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap"
      >
        Tải lại
      </button>
      <button
        onClick={dismiss}
        className="px-2 py-1.5 text-slate-400 hover:text-white transition-colors whitespace-nowrap"
        title="Để sau"
      >
        Để sau
      </button>
    </div>
  );
}
