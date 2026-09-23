// P3: atoms + tokens + helpers thuần của màn HRM (tách từ HRMView.tsx — không phụ thuộc
// closure, dùng chung cho các tab sẽ tách ở slice sau).
'use client';

import React from 'react';
import type { AttendanceStatus } from '@/lib/hrm';

// ---------- Design tokens (bắc cầu sang design system chung — components/ui/*) ----------
// BTN_* giữ API class-string cũ (HRMView dùng trực tiếp), giá trị dùng token primary/success.
export const CARD = 'bg-card rounded-xl border border-line shadow-sm';
export const INPUT =
  'mt-1 w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md outline-none transition focus:border-primary';
export const BTN_P =
  'inline-flex items-center justify-center gap-1.5 bg-primary hover:bg-primary-hover active:bg-primary-hover text-on-primary text-xs font-semibold px-3.5 h-8 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs';
export const BTN_OK =
  'inline-flex items-center justify-center gap-1.5 bg-success hover:brightness-110 active:brightness-110 text-white text-xs font-semibold px-3.5 h-8 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs';
export const BTN_BLUE =
  'inline-flex items-center justify-center gap-1.5 bg-primary hover:bg-primary-hover active:bg-primary-hover text-on-primary text-xs font-semibold px-3.5 h-8 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs';
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-semibold px-3 h-8 rounded-lg transition disabled:opacity-50 cursor-pointer';
export const TH = 'px-3 py-2.5 text-left text-xs font-semibold text-slate-700';

export const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500 text-white',
  half: 'bg-teal-500 text-white',
  leave_paid: 'bg-sky-500 text-white',
  leave_unpaid: 'bg-rose-400 text-white',
  holiday: 'bg-violet-500 text-white',
};

export const STATUS_CHIP: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  half: 'bg-teal-50 text-teal-800 border-teal-200',
  leave_paid: 'bg-sky-50 text-sky-800 border-sky-200',
  leave_unpaid: 'bg-rose-50 text-rose-700 border-rose-200',
  holiday: 'bg-violet-50 text-violet-800 border-violet-200',
};

export const PAYROLL_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Nháp', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  finalized: { label: 'Đã chốt', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  paid: { label: 'Đã chi', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const AVATAR_TONES = [
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
  'bg-blue-100 text-blue-800',
  'bg-violet-100 text-violet-800',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
];

export function avatarTone(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const ROLE_LABELS: Record<string, string> = { admin: 'Quản trị', manager: 'Quản lý', cashier: 'Thu ngân', worker: 'Thợ' };

// Thâm niên từ ngày vào làm: "2 năm 3 tháng" / "5 tháng" / "—"
export function seniority(startIso?: string): string {
  if (!startIso) return '—';
  const from = new Date(startIso + 'T00:00:00');
  const now = new Date();
  if (isNaN(from.getTime()) || from > now) return '—';
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months--;
  if (months < 1) return 'Chưa đủ tháng';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} tháng`;
  return m === 0 ? `${y} năm` : `${y} năm ${m} tháng`;
}

// DD/MM/YYYY từ ISO
export function toDMY(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-11 h-11 text-base' : size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-extrabold shrink-0 ${cls} ${avatarTone(name)}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  valueCls,
  iconCls,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  valueCls: string;
  iconCls: string;
}) {
  return (
    <div className={`${CARD} p-4 flex items-start gap-3`}>
      <span className={`p-2 rounded-lg ${iconCls}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
        <div className={`text-xl font-extrabold tabular-nums leading-tight mt-0.5 ${valueCls}`}>{value}</div>
        <div className="text-xs text-slate-400 mt-0.5 truncate">{sub}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-10 text-center">
      <div className="mx-auto w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">{icon}</div>
      <div className="mt-2 text-sm font-bold text-slate-700">{title}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200/70 rounded-xl ${className}`} aria-hidden="true" />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1 py-px bg-slate-100 border border-slate-300 rounded text-[10px] font-mono font-bold">{children}</kbd>;
}

export function currentMonthKey(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}
