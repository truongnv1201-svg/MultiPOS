'use client';

import React, { useEffect } from 'react';

// Error boundary cấp route (0050-thương mại): crash render 1 màn hình không còn
// trắng cả app — hiện màn hình lỗi tiếng Việt + nút thử lại / về POS.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Ghi log kỹ thuật cho Admin (không hiện raw cho thu ngân)
    console.error('[MultiPOS] Lỗi màn hình:', error);
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-slate-100 text-center px-6 py-16">
      <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-2xl">
        !
      </div>
      <div className="font-bold text-slate-800">Đã xảy ra lỗi ở màn hình này</div>
      <div className="text-xs text-slate-500 max-w-sm leading-relaxed">
        Dữ liệu đã lưu không bị mất. Hãy thử tải lại màn hình — nếu lỗi lặp lại, chụp mã lỗi
        gửi quản trị viên.
        {error?.digest ? (
          <span className="block mt-1 font-mono text-[10px] text-slate-400">Mã lỗi: {error.digest}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={() => reset()}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
        >
          Thử lại
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
        >
          Tải lại trang
        </button>
      </div>
    </div>
  );
}
