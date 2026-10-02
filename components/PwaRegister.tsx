'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// Đăng ký service worker (chỉ production để tránh cache bẩn khi dev).
// Phát hiện bản mới bằng 2 đường (banner chung "Có bản mới"):
//  1. SW mới install xong (updatefound) + chủ động update() mỗi 30 phút cho tab
//     POS mở lâu không điều hướng. Đường này CHỈ bắt khi file sw.js đổi.
//  2. So SHA deploy: hỏi /api/version (SHA commit lúc build) mỗi 5 phút + khi quay
//     lại tab. SHA đổi = Vercel vừa deploy bản mới (dù sw.js không đổi).
// KHÔNG tự reload (kẻo mất giỏ hàng đang bán) — hiện banner để user chủ động
// tải lại lúc rảnh.
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

  // So SHA deploy (đường 2): chạy mọi môi trường, tự tắt khi server không có SHA.
  const firstShaRef = useRef<string | null>(null);
  const latestShaRef = useRef<string | null>(null);
  const dismissedShaRef = useRef<string | null>(null);
  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { sha?: string | null };
      const sha = data?.sha || null;
      if (!sha) return;
      latestShaRef.current = sha;
      if (firstShaRef.current === null) {
        firstShaRef.current = sha;
        return;
      }
      if (sha !== firstShaRef.current && sha !== dismissedShaRef.current) {
        setUpdateReady(true);
      }
    } catch {
      // offline/lỗi mạng: bỏ qua, lần sau kiểm tra lại
    }
  }, []);

  useEffect(() => {
    // Gọi async sau tick hiện tại (không setState đồng bộ trong effect — theo idiom repo)
    const first = window.setTimeout(() => {
      void checkVersion();
    }, 0);
    const timer = window.setInterval(() => {
      void checkVersion();
    }, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVersion();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkVersion]);

  const reloadNow = useCallback(() => {
    window.location.reload();
  }, []);

  const dismiss = useCallback(() => {
    dismissedShaRef.current = latestShaRef.current;
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
