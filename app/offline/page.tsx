import Link from 'next/link';

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-2xl">
        M
      </div>
      <h1 className="text-xl font-bold">Đang ngoại tuyến</h1>
      <p className="text-sm text-slate-300 max-w-sm">
        Không có kết nối mạng. Đơn hàng trong ca vẫn bán được ở chế độ Offline — dữ liệu chờ trong hàng đợi và
        tự đồng bộ khi có mạng lại (OFF-ERR-01).
      </p>
      <Link href="/" className="px-4 py-2 bg-emerald-600 rounded-lg text-sm font-bold">
        Thử tải lại POS
      </Link>
    </main>
  );
}
