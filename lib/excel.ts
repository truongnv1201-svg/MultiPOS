'use client';

// Dùng chung Xuất Excel / Nhập Excel / In bảng cho mọi trang có bảng dữ liệu.
// - Xuất/nhập dùng SheetJS (xlsx) — chạy hoàn toàn phía trình duyệt.
// - In bảng dùng iframe ẩn + CSS in riêng (không đụng hệ thống in phiếu #print-area).

import * as XLSX from 'xlsx';
import { isMobileViewport, printHtmlInTab } from '@/lib/print';

export interface ExcelSheet {
  name: string;
  rows: Record<string, unknown>[];
}

function safeFileName(base: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${base.replace(/[\\/:*?"<>|#%&{}$!'@+=`~]/g, '').trim() || 'du-lieu'}-${stamp}.xlsx`;
}

/** Xuất 1 hoặc nhiều sheet ra file .xlsx và tải về. */
export function exportToExcel(baseName: string, sheets: ExcelSheet | ExcelSheet[]): void {
  const list = Array.isArray(sheets) ? sheets : [sheets];
  const wb = XLSX.utils.book_new();
  for (const s of list) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length > 0 ? s.rows : [{}]);
    // Cột rộng theo nội dung (ước lượng đơn giản)
    const keys = s.rows.length > 0 ? Object.keys(s.rows[0]) : [];
    ws['!cols'] = keys.map((k) => {
      let w = String(k).length;
      for (const r of s.rows.slice(0, 200)) {
        const v = r[k];
        const len = v === null || v === undefined ? 0 : String(v).length;
        if (len > w) w = len;
      }
      return { wch: Math.min(48, Math.max(10, w + 2)) };
    });
    XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Sheet1').slice(0, 31));
  }
  XLSX.writeFile(wb, safeFileName(baseName), { compression: true });
}

/** Tải file Excel mẫu để nhập liệu (1 dòng ví dụ, có thể xóa). */
export function downloadExcelTemplate(baseName: string, headers: string[], sample?: Record<string, unknown>): void {
  const row: Record<string, unknown> = {};
  for (const h of headers) row[h] = sample?.[h] ?? '';
  exportToExcel(`${baseName}-mau-nhap`, [{ name: 'NhapLieu', rows: [row] }]);
}

/** Đọc file .xlsx/.csv -> { headers, rows } (sheet đầu tiên, ô trống = ''). */
export async function readExcelFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return { headers: [], rows: [] };
  const ws = wb.Sheets[first];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (raw.length === 0) return { headers: [], rows: [] };
  const headers = (raw[0] as unknown[]).map((h) => String(h ?? '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < raw.length; i++) {
    const line = raw[i] as unknown[];
    if (line.every((c) => String(c ?? '').trim() === '')) continue; // bỏ dòng trắng
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h) rec[h] = String(line[j] ?? '').trim();
    });
    rows.push(rec);
  }
  return { headers, rows };
}

/** Parse số từ ô Excel (chịu được dấu . , đ, khoảng trắng). */
export function parseExcelNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!s) return 0;
  // Ưu tiên chuẩn vi-VN (. hàng nghìn, , thập phân); fallback chuẩn US
  let n: number;
  if (s.includes(',')) {
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    n = parseFloat(s.replace(/\./g, ''));
  } else {
    n = parseFloat(s);
  }
  return Number.isFinite(n) ? n : 0;
}

/** Mở hộp chọn file Excel 1 lần (không cần thẻ input trong JSX). */
export function pickExcelFile(onFile: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.remove();
  };
  input.click();
}

// ---------- In bảng ----------

export interface PrintColumn {
  header: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export interface PrintTableOptions {
  title: string;
  subtitle?: string;
  meta?: string[];
  columns: PrintColumn[];
  rows: (string | number)[][];
  footer?: (string | number)[];
}

function escapeHtml(v: string | number): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** In 1 bảng dữ liệu: dựng tài liệu in trong iframe ẩn rồi gọi print. */
export function printTable(opts: PrintTableOptions): void {
  const { title, subtitle, meta, columns, rows, footer } = opts;
  const now = new Date();
  const printedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(
    now.getHours()
  ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ths = columns
    .map(
      (c, i) =>
        `<th style="text-align:${c.align || (i === 0 ? 'left' : 'left')}${c.width ? `;width:${c.width}` : ''}">${escapeHtml(c.header)}</th>`
    )
    .join('');
  const trs = rows
    .map(
      (r, ri) =>
        `<tr>${r
          .map((cell, ci) => `<td style="text-align:${columns[ci]?.align || 'left'}">${escapeHtml(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('');
  const tfoot = footer
    ? `<tfoot><tr>${footer.map((cell, ci) => `<td style="text-align:${columns[ci]?.align || 'left'}"><strong>${escapeHtml(cell)}</strong></td>`).join('')}</tr></tfoot>`
    : '';
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 16px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; text-transform: uppercase; }
  .sub { color: #555; margin-bottom: 2px; }
  .meta { color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  th, td { border: 1px solid #999; padding: 5px 7px; }
  th { background: #eee; }
  tr { page-break-inside: avoid; }
  tfoot td { background: #f5f5f5; }
  .foot { margin-top: 10px; color: #555; display: flex; justify-content: space-between; }
  @page { size: A4 landscape; margin: 12mm; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ''}
${meta && meta.length > 0 ? `<div class="meta">${meta.map(escapeHtml).join(' &nbsp;•&nbsp; ')}</div>` : ''}
<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody>${tfoot}</table>
<div class="foot"><span>In lúc: ${printedAt}</span><span>Trang <span class="pageno"></span></span></div>
</body></html>`;

  // Giai đoạn 4: điện thoại hay chặn auto-print trong iframe -> mở tab in có nút bấm.
  if (isMobileViewport()) {
    const preview = html.replace(
      '</body>',
      '<script>window.addEventListener("load", function () { window.focus(); window.print(); });<\/script></body>'
    );
    printHtmlInTab(preview, title);
    return;
  }

  printDocumentViaIframe(html);
}

/** In tài liệu HTML tự chứa trong iframe ẩn rồi gọi print (đường in desktop). */
export function printDocumentViaIframe(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => {
    setTimeout(() => iframe.remove(), 1000);
  };
  iframe.contentWindow?.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 30000); // fallback nếu afterprint không bắn
}
