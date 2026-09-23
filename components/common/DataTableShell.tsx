'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';

interface DataTableShellProps {
  children: React.ReactNode;
  className?: string;
}

// Giữ API cũ — implement trên Card chuẩn để mọi bảng trắng đồng nhất.
export function DataTableShell({ children, className = '' }: DataTableShellProps) {
  return <Card className={`flex flex-col h-full ${className}`}>{children}</Card>;
}
