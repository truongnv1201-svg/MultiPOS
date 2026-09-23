'use client';

import React from 'react';

// Ô nhập liệu có nhãn — label luôn hiển thị phía trên (không dùng placeholder thay label),
// lỗi đỏ ngay dưới ô, gợi ý xám. Dùng cho mọi form thêm/sửa (KH, hàng hóa, NV, phiếu...).
export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`block min-w-0 ${className}`}>
      <span className="block text-xs font-semibold text-ink-soft mb-1">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="block mt-1 text-[11px] font-medium text-destructive">{error}</span>
      ) : hint ? (
        <span className="block mt-1 text-[11px] text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

// Class input chuẩn (kèm Field hoặc dùng lẻ trong filter bar)
export const INPUT_CLS =
  'h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none disabled:opacity-50 disabled:bg-slate-50';
