'use client';

import { useEffect } from 'react';

// Đăng ký service worker (chỉ production để tránh cache bẩn khi dev).
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] SW register failed:', err);
    });
  }, []);
  return null;
}
