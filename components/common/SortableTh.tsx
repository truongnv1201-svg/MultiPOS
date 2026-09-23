'use client';

import React, { useState } from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import type { SortDir } from '@/lib/sort';

// State sắp xếp dùng chung: key rỗng = giữ nguyên thứ tự lọc (mặc định như cũ).
export function useSortState(defaultKey = '', defaultDir: SortDir = 'asc') {
  const [sortKey, setSortKey] = useState<string>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  // Đổi cột -> về asc; bấm lại cùng cột -> đảo chiều (không lồng setState để updater thuần khiết).
  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  return { sortKey, sortDir, toggleSort };
}

interface SortableThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  label: string;
  sortKey: string;
  activeKey: string;
  dir: SortDir;
  onSort: (key: string) => void;
}

// <th> bấm được để sắp xếp — giữ nguyên style bảng cũ, thêm icon + tooltip.
export function SortableTh({ label, sortKey, activeKey, dir, onSort, className = '', title, ...rest }: SortableThProps) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`${className} cursor-pointer select-none hover:text-blue-700 whitespace-nowrap`}
      onClick={() => onSort(sortKey)}
      title={title || `Sắp xếp theo ${label}`}
      {...rest}
    >
      <span className="inline-flex items-center gap-1">
        <span>{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="w-3 h-3 text-blue-600" />
          ) : (
            <ArrowDown className="w-3 h-3 text-blue-600" />
          )
        ) : (
          <ChevronsUpDown className="w-3 h-3 text-slate-300" />
        )}
      </span>
    </th>
  );
}
