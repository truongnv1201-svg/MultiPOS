'use client';

// Error boundary gốc (0050-thương mại): last-resort khi layout/root crash.
// Phải tự render <html><body> vì layout gốc đã lỗi.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <body>
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: '#0f172a',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>MultiPOS gặp sự cố nghiêm trọng</div>
          <div style={{ fontSize: 12, color: '#94a3b8', maxWidth: 420, lineHeight: 1.6 }}>
            Hãy tải lại trang. Dữ liệu local (IndexedDB) không bị ảnh hưởng.
            {error?.digest ? ` Mã lỗi: ${error.digest}` : ''}
          </div>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Tải lại ứng dụng
          </button>
        </div>
      </body>
    </html>
  );
}
