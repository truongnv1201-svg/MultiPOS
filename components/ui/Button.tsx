'use client';

import React from 'react';

// Nút chuẩn MultiPOS — mọi nút trong app dùng component này (không viết class tay).
// variant: primary (blue) / secondary (trắng viền) / success / danger / ghost
// outline-<tone>: nút viền màu cho cụm công cụ (Excel emerald, Nhập blue...)
// size: sm (h-8 text-xs — filter bar/bảng) / md (h-9 text-sm — modal/form) / icon (ô vuông)
type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'ghost'
  | 'ghost-light'
  | 'outline-info'
  | 'outline-success'
  | 'outline-danger'
  | 'outline-accent';
type ButtonSize = 'sm' | 'md' | 'icon';

const VARIANT_CLS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-xs',
  secondary: 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100',
  success: 'bg-success text-white hover:brightness-110 shadow-xs',
  danger: 'bg-destructive text-on-destructive hover:brightness-110 shadow-xs',
  ghost: 'text-slate-600 hover:bg-slate-100',
  'ghost-light': 'text-slate-300 hover:bg-white/10 hover:text-white',
  'outline-info': 'bg-white border border-blue-300 text-blue-700 hover:bg-blue-50',
  'outline-success': 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50',
  'outline-danger': 'bg-white border border-rose-300 text-rose-700 hover:bg-rose-50',
  'outline-accent': 'bg-white border border-amber-300 text-amber-700 hover:bg-amber-50',
};

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs rounded-md',
  md: 'h-9 px-4 text-sm rounded-lg',
  icon: 'w-7 h-7 rounded text-xs',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`font-medium inline-flex items-center justify-center gap-1 transition-colors cursor-pointer select-none disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${className}`}
      {...rest}
    >
      {loading ? 'Đang xử lý…' : children}
    </button>
  );
}
