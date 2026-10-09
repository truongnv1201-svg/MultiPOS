'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check } from 'lucide-react';

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
// Tự vẽ (nút + bảng chọn) thay cho <select> gốc vì popup của select gốc do hệ
// điều hành vẽ, CSS không chạm được. Giữ nguyên props nên mọi chỗ dùng không
// phải sửa. Bảng chọn portal ra body + fixed để không bị card overflow-hidden
// cắt; đóng khi bấm ngoài / cuộn / resize / Esc; phím ↑↓ + Enter đầy đủ.
interface FilterSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  title?: string;
  className?: string;
}

export function FilterSelect({ id, value, onChange, options, title, className = '' }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  const close = () => setOpen(false);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    setActiveIdx(idx);
    const width = Math.max(r.width, 170);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    // Gần đáy màn hình thì xổ lên trên thay vì xuống dưới.
    if (window.innerHeight - r.bottom < 280) {
      setPos({ bottom: window.innerHeight - r.top + 4, left, width });
    } else {
      setPos({ top: r.bottom + 4, left, width });
    }
    setOpen(true);
  };

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  // Đóng khi Esc / cuộn / resize; cuộn mục đang trỏ vào tầm nhìn.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onScrollResize = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollResize);
    document.addEventListener('scroll', onScrollResize, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollResize);
      document.removeEventListener('scroll', onScrollResize, true);
    };
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const move = (delta: 1 | -1) => {
    if (options.length === 0) return;
    setActiveIdx((i) => Math.min(options.length - 1, Math.max(0, i + delta)));
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) close();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) openMenu();
            else move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) openMenu();
            else move(-1);
          } else if ((e.key === 'Enter' || e.key === ' ') && open) {
            e.preventDefault();
            const opt = options[activeIdx];
            if (opt) pick(opt.value);
          }
        }}
        className="h-8 px-2 w-full bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-hidden flex items-center justify-between gap-1.5 transition-colors cursor-pointer"
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40 cursor-default" onMouseDown={close} />
            <div
              ref={listRef}
              role="listbox"
              className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl py-1 overflow-y-auto"
              style={{
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                maxHeight: 264,
              }}
            >
              {options.length === 0 && (
                <div className="px-2.5 py-2 text-xs text-slate-400">Không có lựa chọn</div>
              )}
              {options.map((o, i) => {
                const isSel = o.value === value;
                const isActive = i === activeIdx;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    data-idx={i}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.value)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                      isActive ? 'bg-slate-100' : ''
                    } ${isSel ? 'text-blue-700 font-semibold' : 'text-slate-700 font-medium'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
