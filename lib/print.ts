'use client';

// Giai đoạn 4: in từ điện thoại.
// Desktop giữ nguyên đường in cũ (iframe ẩn / window.print trên tab chính).
// Trên điện thoại, trình duyệt hay chặn auto-print trong iframe và popup, nên ta
// mở 1 tab in riêng (Blob URL) kèm nút "In / Lưu PDF" — người dùng bấm 1 phát là
// ra hộp thoại in của hệ thống (chọn máy in nhiệt Bluetooth, hoặc Lưu PDF).

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 1023px)').matches;
}

const TOOLBAR_CSS = `
  .mp-print-toolbar {
    position: sticky; top: 0; z-index: 999; display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; background: #0f172a; color: #fff; font: 600 13px/1.3 system-ui, sans-serif;
  }
  .mp-print-toolbar button {
    min-height: 44px; padding: 0 16px; border: 0; border-radius: 10px; background: #2563eb;
    color: #fff; font: 700 13px system-ui, sans-serif;
  }
  .mp-print-toolbar button[disabled] { background: #475569; }
  .mp-print-toolbar .mp-print-hint { margin-left: auto; font-weight: 500; opacity: 0.75; font-size: 11px; }
  .mp-print-sheet { padding: 8px; display: flex; justify-content: center; background: #f1f5f9; min-height: 100vh; }
  @media print { .mp-print-toolbar { display: none !important; } .mp-print-sheet { padding: 0; background: #fff; } }
`;

function toolbarHtml(title: string): string {
  return `<div class="mp-print-toolbar">
  <button type="button" id="mp-print-now" disabled>Đang tải hình…</button>
  <span>${title.replace(/[<>&]/g, '')}</span>
  <span class="mp-print-hint">Chọn máy in nhiệt / Lưu PDF</span>
</div>`;
}

// Chờ ảnh (VietQR) tải xong rồi mới cho bấm in — tránh in ra phiếu thiếu QR.
const READY_SCRIPT = `<script>
  (function () {
    var btn = document.getElementById('mp-print-now');
    var images = Array.prototype.slice.call(document.images);
    var waits = images.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) { img.onload = img.onerror = resolve; });
    });
    var done = function () { if (btn) { btn.disabled = false; btn.textContent = 'In / Lưu PDF'; } };
    Promise.race([Promise.all(waits), new Promise(function (r) { setTimeout(r, 2500); })]).then(done);
    if (btn) btn.addEventListener('click', function () { window.focus(); window.print(); });
  })();
<\/script>`;

/** Gom CSS đang nạp trong app (cùng origin) để tài liệu in mang đủ style. */
export function collectAppCss(): string {
  if (typeof document === 'undefined') return '';
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = (sheet as CSSStyleSheet).cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) chunks.push(rule.cssText);
    } catch {
      // stylesheet cross-origin (không đọc được) -> bỏ qua
    }
  }
  return chunks.join('\n');
}

/** Mở tài liệu HTML in trong tab mới kèm nút In. Trả false nếu trình duyệt chặn popup. */
export function openPrintableTab(html: string, title: string): boolean {
  if (typeof window === 'undefined') return false;
  const withToolbar = html.includes('</head>')
    ? html.replace('</head>', `<style>${TOOLBAR_CSS}</style></head>`).replace(/<body([^>]*)>/, `<body$1>${toolbarHtml(title)}${READY_SCRIPT}`)
    : html;
  const url = URL.createObjectURL(new Blob([withToolbar], { type: 'text/html;charset=utf-8' }));
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  // Giữ tab in sống đủ lâu (ảnh QR + hộp thoại in), rồi thu hồi Blob.
  win.addEventListener('pagehide', () => URL.revokeObjectURL(url));
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return true;
}

/**
 * In 1 phần tử DOM đang hiển thị (ví dụ #print-area của biên nhận) ra tab in riêng.
 * Dùng cho điện thoại: kéo nội dung + CSS của app vào 1 tài liệu độc lập.
 */
export function printElementInTab(element: HTMLElement, title: string, pageCss?: string): boolean {
  if (typeof document === 'undefined') return false;
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&]/g, '')}</title>
<style>${collectAppCss()}</style>
<style>${pageCss || ''}</style>
<style>body{background:#f1f5f9;margin:0}</style>
</head><body>
<div class="mp-print-sheet">${element.outerHTML}</div>
</body></html>`;
  return openPrintableTab(html, title);
}

/** In tài liệu HTML tự chứa (dùng cho printTable) trong tab mới. */
export function printHtmlInTab(html: string, title: string): boolean {
  return openPrintableTab(html, title);
}
