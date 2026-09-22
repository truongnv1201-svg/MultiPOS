// P3-phần 2 (tiếp): slice Network — trạng thái online/offline trình duyệt.
// Không phụ thuộc slice nào; Transactions + HRM + Store chính đều consume.
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface NetworkSlice {
  isOnline: boolean;
}

const NetworkContext = createContext<NetworkSlice | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(false);

  // Listen for browser online/offline events
  useEffect(() => {
    Promise.resolve().then(() => setIsOnline(navigator.onLine));
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const value: NetworkSlice = { isOnline };
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkSlice {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}
