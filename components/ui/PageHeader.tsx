'use client';

import React from 'react';

// Đầu trang chuẩn: tiêu đề + mô tả + cụm nút bên phải. Mọi view dùng chung để
// thanh công cụ các trang thẳng hàng (title trái, actions phải).
export function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-ink truncate">{title}</h2>
        {subtitle && <p className="text-xs text-ink-soft truncate">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5 ml-auto shrink-0">{actions}</div>}
    </div>
  );
}
