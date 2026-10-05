'use client';

import React from 'react';

// Thanh tiêu đề chuẩn mọi trang quản lý (danh mục/kho/đơn/khách/NCC/sổ quỹ...).
// Quy ước khóa: cao h-14, nền trắng, viền đáy, tiêu đề text-base kèm icon w-5,
// chip đếm xám mono, cụm nút phải sát lề phải. Cuộn ngang trên màn hẹp để
// không vỡ bố cục (lấy theo biến thể đầy đủ nhất — desktop hiển thị y hệt).
interface PageHeaderProps {
  id?: string;
  icon: React.ReactNode;
  title: string;
  /** Tiêu đề rút gọn trên mobile (không truyền = dùng chung title mọi cỡ). */
  shortTitle?: string;
  /** Breakpoint đổi sang tiêu đề rút gọn ('sm' mặc định, 'md' cho trang Kho). */
  shortBreakpoint?: 'sm' | 'md';
  /** Chip đếm, vd "4 mặt hàng". Ẩn khi null/undefined. */
  count?: React.ReactNode;
  /** Cụm bên phải (tabs, TableTools, nút Thêm...). */
  actions?: React.ReactNode;
}

export function PageHeader({ id, icon, title, shortTitle, shortBreakpoint = 'sm', count, actions }: PageHeaderProps) {
  const bp = shortBreakpoint;
  return (
    <div
      id={id}
      className="h-14 px-2 sm:px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-2 shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex items-center gap-3 shrink-0">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
          {icon}
          {shortTitle ? (
            <>
              <span className={`${bp}:hidden`}>{shortTitle}</span>
              <span className={`hidden ${bp}:inline`}>{title}</span>
            </>
          ) : (
            <span>{title}</span>
          )}
        </h2>
        {count != null && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">{count}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
