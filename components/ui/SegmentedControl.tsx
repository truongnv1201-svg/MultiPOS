'use client';

import React from 'react';

// Cụm chuyển tab / pill lọc — dùng chung mọi trang (tab Danh sách/Lịch sử NCC,
// pill lọc nợ, toggle chế độ...). Hai kiểu:
// - "tabs": hộp xám bọc ngoài, option active nền trắng chữ primary
// - "pills": nút lọc rời, cùng cỡ h-8 viền trắng như nút header (Mẫu/Nhập/Excel/In),
//   active nền blue-50 viền blue
export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  variant = 'tabs',
  ariaLabel,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  variant?: 'tabs' | 'pills';
  ariaLabel?: string;
  className?: string;
}) {
  if (variant === 'pills') {
    return (
      <div className={`flex items-center gap-1.5 ${className}`} role="group" aria-label={ariaLabel}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            title={opt.title}
            className={`h-8 px-2.5 text-xs rounded-md font-medium border transition-colors cursor-pointer ${
              value === opt.value
                ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={`flex items-center bg-slate-100 p-1 rounded-lg ${className}`} role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          title={opt.title}
          className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
            value === opt.value ? 'bg-white text-primary shadow-2xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
