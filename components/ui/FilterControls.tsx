'use client';

import React from 'react';
import { Search } from 'lucide-react';

// Ô tìm kiếm chuẩn thanh lọc: icon kính lúp + input h-8.
// onChange nhận chuỗi (caller tự setPage(1) như cũ).
interface SearchInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minWidthClass?: string;
}

export function SearchInput({ id, value, onChange, placeholder, minWidthClass = 'min-w-[180px]' }: SearchInputProps) {
  return (
    <div className={`relative flex-1 ${minWidthClass}`}>
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
      />
    </div>
  );
}

// Dropdown lọc chuẩn thanh lọc (trạng thái, hình thức, thu ngân, nhóm...).
interface FilterSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  title?: string;
  className?: string;
}

export function FilterSelect({ id, value, onChange, options, title, className = '' }: FilterSelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className={`h-8 px-2 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-hidden ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
