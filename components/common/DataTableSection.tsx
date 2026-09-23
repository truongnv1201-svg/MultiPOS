'use client';

import React from 'react';
import { PaginationBar } from '@/components/common/PaginationBar';
import { EmptyState } from '@/components/ui/EmptyState';

interface DataTableSectionProps {
  /** Render function for filter bar */
  filterBar: React.ReactNode;
  /** Render function for metrics strip (optional) */
  metricsStrip?: React.ReactNode;
  /** Table content */
  table: React.ReactNode;
  /** Pagination config */
  pagination: {
    currentPage: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    itemName: string;
  };
  /** Empty state message */
  emptyMessage?: string;
  /** Whether data is empty */
  isEmpty?: boolean;
  /** ClassName for the outer container */
  className?: string;
}

export function DataTableSection({
  filterBar,
  metricsStrip,
  table,
  pagination,
  emptyMessage = 'Không có dữ liệu',
  isEmpty = false,
  className = '',
}: DataTableSectionProps) {
  return (
    <div className={`flex-1 flex flex-col p-4 ${className}`}>
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full">
        {/* Filter Bar */}
        <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          {filterBar}
        </div>

        {/* Metrics Strip */}
        {metricsStrip && (
          <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
            {metricsStrip}
          </div>
        )}

        {/* Table Wrapper */}
        <div className="flex-1 overflow-y-auto scroll-thin">
          {isEmpty ? (
            <EmptyState message={emptyMessage} />
          ) : (
            <div className="overflow-x-auto">
              {table}
            </div>
          )}
        </div>

        {/* Pagination */}
        <PaginationBar
          currentPage={pagination.currentPage}
          totalItems={pagination.totalItems}
          pageSize={pagination.pageSize}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          itemName={pagination.itemName}
        />
      </div>
    </div>
  );
}