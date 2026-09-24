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
import { AttendanceTab } from './AttendanceTab';
import { PayrollTab } from './PayrollTab';
// ---------- Tab Chấm công & Lương (chung 1 tháng) ----------
export function AttendancePayrollTab({
  employees,
  attendanceDays,
  payrollLocks,
  payrollRuns,
  payrollItems,
  advances,
  payrollStaleMonths,
  isManager,
  onMark,
  onClear,
  onGenerate,
  onLockMonth,
  onReopen,
  onPay,
  onAddAdvance,
  onDeleteAdvance,
}: {
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  payrollLocks: string[];
  payrollRuns: PayrollRun[];
  payrollItems: PayrollItem[];
  advances: SalaryAdvance[];
  payrollStaleMonths: string[];
  isManager: boolean;
  onMark: (input: { employee_id: string; work_date: string; status: AttendanceStatus; ot_hours?: number; note?: string }) => Promise<boolean>;
  onClear: (id: string) => Promise<boolean>;
  onGenerate: (month: string) => Promise<boolean>;
  onLockMonth: (month: string) => Promise<boolean>;
  onReopen: (runId: string) => Promise<boolean>;
  onPay: (runId: string, fund: 'cash' | 'bank') => Promise<boolean>;
  onAddAdvance: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; advance_date: string; note?: string }) => Promise<boolean>;
  onDeleteAdvance: (id: string) => Promise<boolean>;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const handleMonthChange = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
  };
  const [busy, setBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [fund, setFund] = useState<'cash' | 'bank'>('cash');
  const [advOpen, setAdvOpen] = useState(false);
  const staleRun = payrollRuns.find((r) => r.month === monthKey);
  const isStale = !!staleRun && staleRun.status === 'draft' && payrollStaleMonths.includes(monthKey);
  const run = staleRun;
  const isDraft = run?.status === 'draft';
  const items = useMemo(() => payrollItems.filter((i) => i.run_id === run?.id), [payrollItems, run]);

  // ---- Xuất Excel / In bảng lương ----
  const payrollToRow = (it: PayrollItem): Record<string, unknown> => ({
    'Nhân viên': it.employee_name,
    'Hình thức': it.salary_type === 'daily' ? 'Ngày' : 'Tháng',
    'Lương gốc': it.base_salary,
    'Công': it.days,
    'OT (giờ)': it.ot_hours,
    'Tiền OT': otPay(it.salary_type === 'daily' ? it.base_salary : it.base_salary / HR_POLICY.standardDaysPerMonth, it.ot_hours),
    'Gross': it.gross,
    'Phụ cấp': it.allowance,
    'Tạm ứng': it.advance,
    'Khấu trừ': it.deduction,
    'Thực nhận': it.net,
    'Đã chi': it.paid ? 'x' : '',
  });

  const handleExportPayroll = () => {
    if (!run || items.length === 0) {
      notify('Chưa có bảng lương để xuất!', 'error');
      return;
    }
    exportToExcel(`bang-luong-${monthKey}`, [
      { name: 'BangLuong', rows: items.map(payrollToRow) },
      {
        name: 'TamUng',
        rows: advances
          .filter((a) => a.month === monthKey)
          .map((a) => ({
            'Ngày': a.advance_date,
            'Nhân viên': employees.find((e) => e.id === a.employee_id)?.full_name || '',
            'Số tiền': a.amount,
            'Quỹ': a.fund_type === 'cash' ? 'Tiền mặt' : 'Ngân hàng',
            'Phiếu chi': a.cashbook_code || '',
            'Ghi chú': a.note || '',
          })),
      },
    ]);
  };

  const handlePrintPayroll = () => {
    if (!run || items.length === 0) {
      notify('Chưa có bảng lương để in!', 'error');
      return;
    }
    printTable({
      title: `Bảng lương tháng ${monthKey}`,
      meta: [`${run.headcount} người`, `Tổng thực chi: ${formatVND(run.total_net)}`, `Trạng thái: ${PAYROLL_STATUS_META[run.status].label}`],
      columns: [
        { header: 'Nhân viên' },
        { header: 'Công', align: 'right' },
        { header: 'OT', align: 'right' },
        { header: 'Gross', align: 'right' },
        { header: 'Phụ cấp', align: 'right' },
        { header: 'Tạm ứng', align: 'right' },
        { header: 'Thực nhận', align: 'right' },
      ],
      rows: items.map((it) => [
        it.employee_name,
        String(it.days),
        it.ot_hours > 0 ? `${it.ot_hours}h` : '',
        it.gross.toLocaleString('vi-VN'),
        it.allowance ? it.allowance.toLocaleString('vi-VN') : '',
        it.advance ? it.advance.toLocaleString('vi-VN') : '',
        it.net.toLocaleString('vi-VN'),
      ]),
      footer: ['Tổng', String(run.total_days), '', run.total_gross.toLocaleString('vi-VN'), run.total_allowance.toLocaleString('vi-VN'), run.total_advance.toLocaleString('vi-VN'), run.total_net.toLocaleString('vi-VN')],
    });
  };

  return (
    <div className="space-y-4">
      <section aria-label={`Chấm công tháng ${monthKey}`}>
        <AttendanceTab
          employees={employees}
          attendanceDays={attendanceDays}
          payrollLocks={payrollLocks}
          isManager={isManager}
          year={year}
          month={month}
          onMonthChange={handleMonthChange}
          onMark={onMark}
          onClear={onClear}
        />
      </section>
      <section aria-label={`Bảng lương tháng ${monthKey}`}>
        <div className={`${CARD} overflow-hidden flex flex-col`}>
        {/* Toolbar lương — cùng khối với bảng (chuẩn bảng chung) */}
        <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold text-slate-800">Bảng lương tháng {monthKey}</h3>
          {isManager && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                disabled={busy || run?.status === 'paid'}
                onClick={async () => {
                  if (run && run.status === 'paid') {
                    notify(`Tháng ${monthKey} đã chi lương — không tạo lại được!`, 'error');
                    return;
                  }
                  setBusy(true);
                  try {
                    await onGenerate(monthKey);
                  } finally {
                    setBusy(false);
                  }
                }}
                className={BTN_P}
                title="Dựng lại bảng nháp từ số liệu mới nhất"
              >
                {run ? <RefreshCw className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {run ? 'Làm mới' : 'Lập bảng lương'}
              </button>
              <button
                onClick={() => setAdvOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg px-3 py-1.5 transition cursor-pointer"
                title="Ghi / xem các lần tạm ứng (mỗi lần sinh 1 phiếu chi)"
              >
                <Wallet className="w-4 h-4" /> Tạm ứng
              </button>
              {(!run || isDraft) && (
                <button
                  disabled={lockBusy}
                  onClick={async () => {
                    setLockBusy(true);
                    try {
                      await onLockMonth(monthKey);
                    } finally {
                      setLockBusy(false);
                    }
                  }}
                  className={BTN_BLUE}
                  title="Dựng lại bảng từ số mới nhất + khóa chấm công + chốt lương (1 lần)"
                >
                  <Lock className="w-4 h-4" /> {lockBusy ? 'Đang chốt…' : 'Chốt tháng'}
                </button>
              )}
              {run && run.status === 'finalized' && (
                <>
                  <button onClick={() => onReopen(run.id)} className={BTN_GHOST}>
                    <LockOpen className="w-4 h-4" /> Mở lại
                  </button>
                  <select value={fund} onChange={(e) => setFund(e.target.value as 'cash' | 'bank')} aria-label="Quỹ chi lương" className="text-xs bg-white border border-slate-300 rounded-md px-2 h-8 text-slate-700 font-medium">
                    <option value="cash">Tiền mặt</option>
                    <option value="bank">Ngân hàng</option>
                  </select>
                  <button onClick={() => onPay(run.id, fund)} className={BTN_OK}>
                    <Banknote className="w-4 h-4" /> Chi lương
                  </button>
                </>
              )}
              {run && items.length > 0 && <TableTools onExportExcel={handleExportPayroll} onPrint={handlePrintPayroll} />}
            </div>
          )}
          {isStale && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800" role="status">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
              Bảng lương có dữ liệu thay đổi, bấm làm mới để xem
            </span>
          )}
        </div>
        <PayrollTab
          month={monthKey}
          run={run}
          items={items}
          advances={advances}
          employees={employees}
          locked={payrollLocks.includes(monthKey)}
          isManager={isManager}
          onAddAdvance={onAddAdvance}
          onDeleteAdvance={onDeleteAdvance}
          advOpen={advOpen}
          onCloseAdv={() => setAdvOpen(false)}
        />
        </div>
      </section>
    </div>
  );
}
