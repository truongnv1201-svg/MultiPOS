'use client';

// HRM — 1 màn duy nhất, 5 tabs: Tổng quan / Nhân sự / Chấm công / Nghỉ phép / Lương.
// Redesign: mật độ dashboard, thẻ KPI, ma trận sticky + phím tắt, drawer hồ sơ, stepper lương.

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { formatVND } from '@/lib/format';
import { NumberInput } from '@/components/common/NumberInput';
import { exportToExcel, downloadExcelTemplate, readExcelFile, parseExcelNum, printTable } from '@/lib/excel';
import {
  ATTENDANCE_STATUS_META,
  ATTENDANCE_STATUS_ORDER,
  POSITION_OPTIONS,
  HR_POLICY,
  otPay,
  nextEmployeeCode,
  monthDays,
  todayIso,
  buildPayrollItem,
} from '@/lib/hrm';
import type { AttendanceDay, AttendanceStatus, Employee, PayrollItem, PayrollRun, SalaryAdvance } from '@/lib/hrm';
import type { EmployeeInput, HrmAccount } from '@/lib/store';
import {
  Users,
  ClipboardCheck,
  Banknote,
  LayoutDashboard,
  Plus,
  Pencil,
  Lock,
  LockOpen,
  ChevronLeft,
  ChevronRight,
  Search,
  Check,
  X,
  RefreshCw,
  CalendarDays,
  Clock,
  Wallet,
  TrendingUp,
  TriangleAlert,
  Keyboard,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { TableTools } from '@/components/common/TableTools';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';
// P3: atoms/tokens/helpers thuần dùng chung các tab (tách ra ui.tsx).
import {
  CARD,
  INPUT,
  BTN_P,
  BTN_OK,
  BTN_BLUE,
  BTN_GHOST,
  TH,
  STATUS_STYLE,
  STATUS_CHIP,
  PAYROLL_STATUS_META,
  avatarTone,
  initialsOf,
  ROLE_LABELS,
  seniority,
  toDMY,
  Avatar,
  StatCard,
  EmptyState,
  Skeleton,
  Kbd,
  currentMonthKey,
} from '@/components/hrm/ui';
// ---------- Panel tạm ứng lương (model riêng, có chứng từ, tự trừ vào bảng lương) ----------
export function AdvancesModal({
  month,
  employees,
  advances,
  locked,
  isManager,
  onAdd,
  onDelete,
  onClose,
}: {
  month: string;
  employees: Employee[];
  advances: SalaryAdvance[];
  locked: boolean;
  isManager: boolean;
  onAdd: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; advance_date: string; note?: string }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [empId, setEmpId] = useState('');
  const [amount, setAmount] = useState(0);
  const [fund, setFund] = useState<'cash' | 'bank'>('cash');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const actives = useMemo(() => employees.filter((e) => e.status === 'active').sort((a, b) => a.code.localeCompare(b.code)), [employees]);
  const list = useMemo(
    () => advances.filter((a) => a.month === month).sort((a, b) => b.advance_date.localeCompare(a.advance_date) || b.created_at.localeCompare(a.created_at)),
    [advances, month],
  );
  const total = list.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name || '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Tạm ứng lương tháng ${month}`}>
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2 shrink-0">
          <Wallet className="w-4 h-4 text-amber-400" />
          <h3 className="font-bold text-sm">Tạm ứng lương tháng {month}</h3>
          <span className="text-[11px] tabular-nums font-bold text-amber-300">
            {formatVND(total)} · {list.length} lần
          </span>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white transition cursor-pointer" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-xs overflow-y-auto">
      {isManager && !locked && (
        <div className="flex flex-wrap items-end gap-2 mt-2.5 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          <label className="text-xs font-semibold text-slate-700">
            Nhân viên <span className="text-rose-500">*</span>
            <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="mt-1 border border-slate-300 rounded-md px-2 h-8 text-xs bg-white min-w-[170px] block">
              <option value="">— Chọn —</option>
              {actives.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Số tiền (đ) <span className="text-rose-500">*</span>
            <NumberInput value={amount} min={0} onChange={setAmount} placeholder="0" className="mt-1 border border-slate-300 rounded-md px-2 h-8 text-xs tabular-nums w-32 block" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Quỹ chi
            <select value={fund} onChange={(e) => setFund(e.target.value as 'cash' | 'bank')} className="mt-1 border border-slate-300 rounded-md px-2 h-8 text-xs bg-white block">
              <option value="cash">Tiền mặt</option>
              <option value="bank">Ngân hàng</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Ngày ứng
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 border border-slate-300 rounded-md px-2 h-8 text-xs tabular-nums block" />
          </label>
          <label className="text-xs font-semibold text-slate-700 flex-1 min-w-[140px]">
            Ghi chú
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do ứng…" className="mt-1 border border-slate-300 rounded-md px-2 h-8 text-xs w-full block" />
          </label>
          <button
            disabled={busy || !empId || !amount}
            onClick={async () => {
              setBusy(true);
              try {
                const ok = await onAdd({ employee_id: empId, amount, fund_type: fund, advance_date: date || todayIso(), note });
                if (ok) {
                  setAmount(0);
                  setNote('');
                }
              } finally {
                setBusy(false);
              }
            }}
            className={`${BTN_P} h-8 whitespace-nowrap`}
          >
            <Plus className="w-4 h-4" /> {busy ? 'Đang ghi…' : 'Ghi tạm ứng'}
          </button>
        </div>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto border border-slate-100 rounded-lg">
          {list.map((a) => (
            <li key={a.id} className="px-2.5 py-1.5 flex items-center gap-2 text-xs hover:bg-slate-50">
              <span className="tabular-nums text-slate-500 whitespace-nowrap">{a.advance_date.slice(8)}/{a.advance_date.slice(5, 7)}</span>
              <Avatar name={empName(a.employee_id)} size="sm" />
              <span className="font-bold text-slate-800 truncate">{empName(a.employee_id)}</span>
              <span className="font-extrabold tabular-nums text-amber-700 whitespace-nowrap">−{formatVND(a.amount)}</span>
              <span className="px-1.5 py-px text-[10px] font-bold rounded bg-slate-100 text-slate-600 whitespace-nowrap">
                {a.fund_type === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}
              </span>
              {a.note && <span className="text-slate-400 truncate">{a.note}</span>}
              {a.cashbook_code && <span className="ml-auto font-mono text-[10px] text-slate-400 whitespace-nowrap">{a.cashbook_code}</span>}
              {isManager && !locked && (
                <button
                  onClick={() => onDelete(a.id)}
                  className={`${a.cashbook_code ? '' : 'ml-auto'} p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer`}
                  title="Xóa lần ứng này (xóa luôn phiếu chi)"
                  aria-label={`Xóa tạm ứng của ${empName(a.employee_id)}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
        </div>
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 shrink-0">
          Mỗi lần ứng sinh 1 phiếu chi trong Sổ quỹ — bảng lương tự trừ vào thực nhận.
        </div>
      </div>
    </div>
  );
}
