'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, Download, HardDriveDownload, RefreshCw, Smartphone, WifiOff } from 'lucide-react';
import { db } from '@/lib/db';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface CacheStatus {
  swState: 'unsupported' | 'no-registration' | 'ready';
  shellCached: boolean;
  products: number;
  customers: number;
  suppliers: number;
  pending: number;
}

const EMPTY: CacheStatus = {
  swState: 'no-registration',
  shellCached: false,
  products: 0,
  customers: 0,
  suppliers: 0,
  pending: 0,
};

// Giai đoạn 3: cho Admin thấy máy đã sẵn sàng chạy offline hay chưa — trước khi mang điện
// thoại ra tiệm mà không chắc app có mở được. Cache catalog nằm ở Dexie, shell do service worker.
export function OfflineReadyCard() {
  const [status, setStatus] = useState<CacheStatus>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  const load = useCallback(async () => {
    const next: CacheStatus = { ...EMPTY };
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      next.swState = reg ? 'ready' : 'no-registration';
      if ('caches' in window) {
        const hit = await caches.match('/');
        next.shellCached = !!hit;
      }
    } else {
      next.swState = 'unsupported';
    }
    next.products = await db.products.count();
    next.customers = await db.customers.count();
    next.suppliers = await db.suppliers.count();
    next.pending = (await db.pendingOps.count()) + (await db.pendingOrders.count()) + (await db.pendingMasterData.count());
    setStatus(next);
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.clearTimeout(timer);
    };
  }, [load]);

  const handleCheckUpdate = async () => {
    if (!('serviceWorker' in navigator)) {
      setMsg('Trình duyệt này không hỗ trợ ứng dụng offline.');
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      setMsg('Chưa có service worker (chỉ chạy ở bản build production).');
      return;
    }
    await reg.update();
    setMsg('Đã kiểm tra cập nhật. Nếu có bản mới, ứng dụng sẽ báo "Có bản mới" ở đầu màn hình.');
    await load();
  };

  const handleInstall = async () => {
    const prompt = installPromptRef.current;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setMsg(choice.outcome === 'accepted' ? 'Đã cài ứng dụng lên máy.' : 'Đã huỷ cài ứng dụng.');
    setCanInstall(false);
  };

  const swLabel =
    status.swState === 'ready'
      ? status.shellCached
        ? 'Sẵn sàng offline'
        : 'Đã đăng ký — chưa cache giao diện'
      : status.swState === 'unsupported'
        ? 'Trình duyệt không hỗ trợ'
        : 'Chưa đăng ký (chạy bản production)';

  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3 text-xs">
      <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
        <CloudOff className="w-4 h-4 text-blue-600" />
        <span>Ứng dụng &amp; chạy offline</span>
        <span
          className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${
            status.swState === 'ready' && status.shellCached ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {swLabel}
        </span>
      </h3>

      <p className="text-[11px] text-slate-500">
        Danh mục hàng, khách và nhà cung cấp được cache trên máy mỗi lần đồng bộ — mất mạng vẫn bán và tra cứu được.
        Hàng đợi chờ gửi: <strong className="font-mono text-slate-700">{status.pending}</strong> thao tác.
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Hàng hóa', value: status.products },
          { label: 'Khách hàng', value: status.customers },
          { label: 'Nhà cung cấp', value: status.suppliers },
        ].map((row) => (
          <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 py-2">
            <div className="font-mono text-base font-bold text-slate-800">{row.value}</div>
            <div className="text-[10px] text-slate-500">{row.label} đã cache</div>
          </div>
        ))}
      </div>

      {status.pending > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          Có dữ liệu chưa đồng bộ — mở Trung tâm đồng bộ (nút trên thanh tiêu đề) để gửi hoặc bỏ hàng đợi.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          id="btn-check-app-update"
          onClick={handleCheckUpdate}
          className="px-3 h-9 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-bold flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Kiểm tra cập nhật
        </button>
        <button
          onClick={() => {
            void load();
            setMsg('Đã làm mới số liệu cache trên máy.');
          }}
          className="px-3 h-9 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-bold flex items-center gap-1.5"
        >
          <HardDriveDownload className="w-3.5 h-3.5" /> Quét lại cache
        </button>
        {canInstall && (
          <button
            id="btn-install-app"
            onClick={handleInstall}
            className="px-3 h-9 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Cài lên máy
          </button>
        )}
      </div>

      {!canInstall && (
        <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5" />
          Cài ứng dụng: mở menu trình duyệt → &quot;Cài ứng dụng&quot; / &quot;Thêm vào màn hình chính&quot; (Android Chrome).
        </p>
      )}

      {msg && <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">{msg}</p>}
    </div>
  );
}
