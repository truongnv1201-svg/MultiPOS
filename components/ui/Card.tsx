'use client';

import React from 'react';

// Khung trang + thẻ trắng chuẩn: nền app slate, card trắng rounded-xl viền line.
// PageWrap: bọc ngoài mỗi view (flex-1, padding 4). Card: khối nội dung.
export function PageWrap({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex-1 flex flex-col p-4 min-h-0 ${className}`}>{children}</div>;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-xl border border-line shadow-2xs overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function CardBar({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-3 py-2 border-b border-line bg-slate-50 flex flex-wrap items-center gap-2 ${className}`}>
      {children}
    </div>
  );
}
