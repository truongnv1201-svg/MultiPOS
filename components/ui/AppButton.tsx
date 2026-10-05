'use client';

import React from 'react';

// Nút chuẩn trang quản lý: primary xanh (Thêm mới...), secondary trắng viền,
// tone amber cho hành động kho (Điều chỉnh tồn).
// Quy ước khóa: h-8, px-3.5 (primary) / px-3 (secondary), rounded-lg.
// (Nút h-7 trong Cài đặt thuộc ngữ cảnh khác, giữ nguyên tại chỗ.)
type AppButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  tone?: 'blue' | 'amber' | 'emerald' | 'rose';
};

const TONE_CLASSES: Record<NonNullable<AppButtonProps['tone']>, string> = {
  blue: 'bg-blue-600 hover:bg-blue-700',
  amber: 'bg-amber-600 hover:bg-amber-700 disabled:hover:bg-amber-600',
  emerald: 'bg-emerald-600 hover:bg-emerald-700',
  rose: 'bg-rose-600 hover:bg-rose-700',
};

const VARIANTS: Record<NonNullable<AppButtonProps['variant']>, string> = {
  primary:
    'px-3.5 h-8 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs',
  secondary:
    'px-3 h-8 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors text-slate-700',
};

export function AppButton({ variant = 'primary', tone = 'blue', className = '', type = 'button', ...rest }: AppButtonProps) {
  const color = variant === 'primary' ? TONE_CLASSES[tone] : '';
  return (
    <button
      type={type}
      className={`${VARIANTS[variant]} ${color} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...rest}
    />
  );
}
