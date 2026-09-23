'use client';

import React from 'react';
import { Inbox } from 'lucide-react';

// Trạng thái rỗng chuẩn cho mọi bảng/danh sách (thay div text-slate-400 rời rạc).
export function EmptyState({
  message = 'Không có dữ liệu',
  action,
  className = '',
}: {
  message?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`py-12 px-4 text-center ${className}`}>
      <Inbox className="w-8 h-8 mx-auto text-ink-faint" aria-hidden="true" />
      <p className="mt-2 text-xs text-ink-soft">{message}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
