'use client';

import React, { useState } from 'react';
import { Calendar, X } from 'lucide-react';

export type DatePreset = 'all' | 'today' | 'yesterday' | '7days' | 'this_month' | 'custom';

export interface DateFilterState {
  preset: DatePreset;
  fromDate?: string;
  toDate?: string;
}

export function matchesDateFilter(
  dateStr: string | undefined | null,
  filter: DateFilterState
): boolean {
  if (!dateStr || filter.preset === 'all') return true;

  const itemDate = new Date(dateStr);
  if (isNaN(itemDate.getTime())) return true;

  const now = new Date();

  if (filter.preset === 'today') {
    return (
      itemDate.getDate() === now.getDate() &&
      itemDate.getMonth() === now.getMonth() &&
      itemDate.getFullYear() === now.getFullYear()
    );
  }

  if (filter.preset === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return (
      itemDate.getDate() === yesterday.getDate() &&
      itemDate.getMonth() === yesterday.getMonth() &&
      itemDate.getFullYear() === yesterday.getFullYear()
    );
  }

  if (filter.preset === '7days') {
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    return itemDate >= sevenDaysAgo;
  }

  if (filter.preset === 'this_month') {
    return (
      itemDate.getMonth() === now.getMonth() &&
      itemDate.getFullYear() === now.getFullYear()
    );
  }

  if (filter.preset === 'custom') {
    if (filter.fromDate) {
      const from = new Date(`${filter.fromDate}T00:00:00`);
      if (itemDate < from) return false;
    }
    if (filter.toDate) {
      const to = new Date(`${filter.toDate}T23:59:59`);
      if (itemDate > to) return false;
    }
    return true;
  }

  return true;
}

interface DateFilterProps {
  value: DateFilterState;
  onChange: (val: DateFilterState) => void;
  className?: string;
}

export function DateFilter({ value, onChange, className = '' }: DateFilterProps) {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [tempFrom, setTempFrom] = useState(value.fromDate || '');
  const [tempTo, setTempTo] = useState(value.toDate || '');

  const handleSelectPreset = (preset: DatePreset) => {
    if (preset === 'custom') {
      setShowCustomModal(true);
    } else {
      onChange({ preset });
    }
  };

  const handleApplyCustom = () => {
    onChange({
      preset: 'custom',
      fromDate: tempFrom || undefined,
      toDate: tempTo || undefined,
    });
    setShowCustomModal(false);
  };

  return (
    <div className={`relative flex items-center gap-1.5 ${className}`}>
      <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-md px-2 h-8 text-xs text-slate-700">
        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <select
          value={value.preset}
          onChange={(e) => handleSelectPreset(e.target.value as DatePreset)}
          className="bg-transparent font-medium focus:outline-hidden cursor-pointer"
        >
          <option value="all">Toàn thời gian</option>
          <option value="today">Hôm nay</option>
          <option value="yesterday">Hôm qua</option>
          <option value="7days">7 ngày qua</option>
          <option value="this_month">Tháng này</option>
          <option value="custom">Tùy chọn ngày...</option>
        </select>
      </div>

      {value.preset === 'custom' && (
        <div className="flex items-center gap-1 px-2 h-8 bg-blue-50 border border-blue-200 rounded-md text-[11px] font-mono text-blue-800">
          <span>
            {value.fromDate || '...'} → {value.toDate || '...'}
          </span>
          <button
            type="button"
            onClick={() => onChange({ preset: 'all' })}
            className="text-blue-600 hover:text-blue-900 ml-1 p-0.5"
            title="Xóa bộ lọc ngày"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Modal Custom Date */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xs overflow-hidden p-4 space-y-3 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-blue-600" />
                Chọn khoảng ngày
              </span>
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Từ ngày:</label>
                <input
                  type="date"
                  value={tempFrom}
                  onChange={(e) => setTempFrom(e.target.value)}
                  className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-md text-xs focus:border-blue-500 focus:outline-hidden font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Đến ngày:</label>
                <input
                  type="date"
                  value={tempTo}
                  onChange={(e) => setTempTo(e.target.value)}
                  className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-md text-xs focus:border-blue-500 focus:outline-hidden font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleApplyCustom}
                className="px-3.5 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
