'use client';

import React from 'react';

// Nhãn trạng thái (pill) — trạng thái đơn, giai đoạn, tồn kho, ca...
// tone: slate (mặc định/nháp) / blue (đang xử lý) / emerald (xong/thu) / amber (chờ/cọc) / rose (hủy/nợ)
export type BadgeTone = 'slate' | 'blue' | 'emerald' | 'amber' | 'rose';

const TONE_CLS: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function Badge({
  tone = 'slate',
  dot = false,
  className = '',
  title,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border whitespace-nowrap ${TONE_CLS[tone]} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

// Map trạng thái đơn hàng -> tone (dùng chung OrdersView + ReceiptModal + Reports)
export function orderStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'completed':
      return 'emerald';
    case 'deposit_order':
    case 'pending':
      return 'amber';
    case 'cancelled':
    case 'returned':
      return 'rose';
    default:
      return 'slate';
  }
}
