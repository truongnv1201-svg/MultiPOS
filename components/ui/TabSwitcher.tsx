'use client';

import React from 'react';

// Cụm chuyển tab pill trong header (Kho: Tồn kho/Thẻ kho/Điều chỉnh; Báo cáo:
// Tổng quan/VAT/Mặt hàng/Công nợ). Quy ước khóa: nền xám, tab active trắng +
// chữ xanh. id/title theo từng option để e2e/tooltip bám được.
export interface TabOption<T extends string> {
  key: T;
  label: string;
  id?: string;
  title?: string;
}

interface TabSwitcherProps<T extends string> {
  id?: string;
  options: TabOption<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function TabSwitcher<T extends string>({ id, options, active, onChange }: TabSwitcherProps<T>) {
  return (
    <div id={id} className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
      {options.map((o) => (
        <button
          key={o.key}
          id={o.id}
          type="button"
          title={o.title}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
            active === o.key ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
