'use client';

import React from 'react';

// Thẻ chỉ số KPI (doanh thu, công nợ, tồn kho...) — dải metrics các trang + Reports.
// Số dùng tnum (đẳng rộng) để không nhảy layout khi nhảy số.
export function Stat({
  label,
  value,
  sub,
  tone = 'slate',
  icon,
  className = '',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose';
  icon?: React.ReactNode;
  className?: string;
}) {
  const VALUE_CLS: Record<string, string> = {
    slate: 'text-ink',
    blue: 'text-primary',
    emerald: 'text-success',
    amber: 'text-accent',
    rose: 'text-destructive',
  };
  return (
    <div className={`bg-card rounded-xl border border-line px-3 py-2 min-w-0 ${className}`}>
      <p className="text-[11px] font-medium text-ink-soft truncate flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className={`text-base font-bold tnum truncate ${VALUE_CLS[tone]}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink-faint truncate">{sub}</p>}
    </div>
  );
}
