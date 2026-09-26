'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, Check, X } from 'lucide-react';
import { useClickOutside } from '@/lib/useClickOutside';

export interface SearchOption {
  value: string;
  label: string;
  sub?: string;
}

// Combobox tìm kiếm gõ-lọc: click mở, gõ để lọc, phím ↑↓ + Enter chọn, Esc đóng.
// allowCustom: cho phép giữ lại chữ tự gõ không có trong danh sách (VD: tên NCC mới).
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Gõ để tìm…',
  disabled = false,
  allowCustom = false,
  className = '',
}: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowCustom?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Chặn blur-commit ghi đè lựa chọn vừa click/Enter (blur bắn sau pick)
  const skipCommit = useRef(false);
  // Bấm nút Xóa xong focus lại input: bỏ qua bước mở dropdown/mền nhãn cũ
  const justCleared = useRef(false);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q)
    );
  }, [options, query]);

  // Reset highlight về đầu danh sách mỗi khi từ khóa đổi (làm trong handler thay vì
  // effect để tránh cascading renders — react-hooks/set-state-in-effect).
  const updateQuery = (v: string) => {
    setQuery(v);
    setActiveIdx(0);
  };

  // Click ra ngoài thì đóng (dùng chung hook với các ô tìm kiếm POS)
  useClickOutside(wrapRef, open, () => {
    setOpen(false);
    setFocused(false);
  });

  const display = focused ? query : selected?.label || (allowCustom ? value : '');

  const commitCustom = () => {
    const q = query.trim();
    if (q && (allowCustom || filtered.length > 0)) {
      if (allowCustom && !filtered.some((o) => o.label.toLowerCase() === q.toLowerCase() || o.value === q)) {
        onChange(q);
      }
    }
  };

  const pick = (opt: SearchOption) => {
    skipCommit.current = true;
    onChange(opt.value);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={display}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => {
            // Bấm nút X xong focus lại: không mở lại danh sách và không nhảy về nhãn cũ.
            if (justCleared.current) {
              justCleared.current = false;
              setFocused(true);
              return;
            }
            skipCommit.current = false;
            updateQuery(selected?.label || (allowCustom ? value : ''));
            setFocused(true);
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onChange={(e) => {
            updateQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            // Delay để kịp nhận click chọn option; bỏ qua nếu vừa pick (tránh ghi đè)
            const skip = skipCommit.current;
            skipCommit.current = false;
            setTimeout(() => {
              if (!skip) commitCustom();
              setFocused(false);
              setOpen(false);
            }, 150);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const opt = filtered[activeIdx];
              if (opt) pick(opt);
              else commitCustom();
              setOpen(false);
              setFocused(false);
            } else if (e.key === 'Escape') {
              setOpen(false);
              setFocused(false);
              inputRef.current?.blur();
            }
          }}
          className="w-full h-8 pl-8 pr-7 text-xs border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50 disabled:text-slate-400"
        />
        {(display || query) && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('');
              updateQuery('');
              setOpen(false);
              justCleared.current = true;
              inputRef.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded"
            aria-label="Xóa lựa chọn"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <ul className="absolute z-50 left-0 right-0 mt-1 h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">
              {allowCustom && query.trim() ? (
                <>
                  Enter để dùng “<span className="font-bold text-slate-600">{query.trim()}</span>”
                </>
              ) : (
                'Không tìm thấy. Thử từ khóa khác.'
              )}
            </li>
          ) : (
            filtered.slice(0, 100).map((opt, idx) => {
              const isSel = opt.value === value;
              const isActive = idx === activeIdx;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(opt)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isActive ? 'bg-blue-50' : ''
                    } hover:bg-blue-50 cursor-pointer`}
                    role="option"
                    aria-selected={isSel}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-slate-800 truncate">{opt.label}</span>
                      {opt.sub && <span className="block text-[11px] text-slate-500 truncate">{opt.sub}</span>}
                    </span>
                    {isSel && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                  </button>
                </li>
              );
            })
          )}
          {filtered.length > 100 && (
            <li className="px-3 py-1.5 text-[11px] text-slate-400">…và {filtered.length - 100} kết quả nữa (gõ thêm để lọc)</li>
          )}
        </ul>
      )}
    </div>
  );
}
