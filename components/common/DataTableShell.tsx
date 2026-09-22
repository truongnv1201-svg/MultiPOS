'use client';

import React from 'react';

interface DataTableShellProps {
  children: React.ReactNode;
  className?: string;
}

export function DataTableShell({ children, className = '' }: DataTableShellProps) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full ${className}`}>
      {children}
    </div>
  );
}
