'use client';

import React from 'react';

// Nhãn trạng thái chuẩn: viên thuốc text-[10px], 6 tone màu cố định.
// Dùng cho Trạng thái đơn, Sắp hết/Hết hàng, badge đếm tab... — cấm hardcode
// chuỗi màu lẻ ngoài map này để khỏi lệch tone giữa các trang.
export type BadgeTone = 'emerald' | 'amber' | 'rose' | 'purple' | 'blue' | 'slate';

const TONE_CLASSES: Record<BadgeTone, string> = {
  emerald: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  rose: 'bg-rose-100 text-rose-800',
  purple: 'bg-purple-100 text-purple-800',
  blue: 'bg-blue-100 text-blue-800',
  slate: 'bg-slate-100 text-slate-600',
};

interface StatusBadgeProps {
  tone: BadgeTone;
  icon?: React.ReactNode;
  /** Dạng viên thuốc bo tròn đầy (mặc định) hay thẻ bo góc nhẹ. */
  pill?: boolean;
  /** Độ đậm chữ: bold (mặc định, badge trạng thái) hay semibold (badge "Đủ hàng"). */
  weight?: 'bold' | 'semibold';
  className?: string;
  children: React.ReactNode;
}

export function StatusBadge({ tone, icon, pill = true, weight = 'bold', className = '', children }: StatusBadgeProps) {
  return (
    <span
      className={`px-2 py-0.5 ${TONE_CLASSES[tone]} ${pill ? 'rounded-full' : 'rounded'} text-[10px] ${
        weight === 'bold' ? 'font-bold' : 'font-semibold'
      } ${icon ? 'inline-flex items-center gap-1' : ''} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
