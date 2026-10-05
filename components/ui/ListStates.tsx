'use client';

import React from 'react';

// Dải tóm tắt số liệu dưới thanh lọc (doanh số lọc / thực thu / còn nợ...).
// Chuẩn: nền xám mờ, chữ 11px, 2 đầu justify-between. Nội dung từng trang tự ráp.
export function SummaryStrip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600 ${className}`}>
      {children}
    </div>
  );
}

// Trạng thái rỗng chuẩn: bảng (ô full-colspan) + danh sách record (đoạn chữ).
export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-slate-400">
        {children}
      </td>
    </tr>
  );
}

export function ListEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-xs text-slate-400">{children}</p>;
}
