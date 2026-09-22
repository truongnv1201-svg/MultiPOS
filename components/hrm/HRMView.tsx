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

type Tab = 'overview' | 'staff' | 'attendance';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Tổng quan', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'staff', label: 'Nhân sự', icon: <Users className="w-4 h-4" /> },
  { id: 'attendance', label: 'Chấm công & Lương', icon: <ClipboardCheck className="w-4 h-4" /> },
];

export function HRMView() {
  const store = useStore();
  const {
    currentScreen,
    profile,
    employees,
    accounts,
    attendanceDays,
    payrollRuns,
    payrollItems,
    advances,
    payrollStaleMonths,
    payrollLocks,
    hrmLoading,
    hrmError,
    refreshHrm,
    saveEmployee,
    createEmployeeWithAccount,
    createAccountForEmployee,
    resetEmployeePassword,
    setEmployeeStatus,
    markDay,
    clearDay,
    generatePayroll,
    lockMonth,
    reopenPayroll,
    payPayroll,
    addAdvance,
    deleteAdvance,
  } = store;

  const isManager = profile?.role === 'admin' || profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin';

  const [subTab, setSubTab] = useState<Tab>('overview');
  // Đồng bộ subTab theo màn hình bằng pattern "adjust state during render" (tránh setState
  // trong effect — react-hooks/set-state-in-effect).
  const [prevScreen, setPrevScreen] = useState(currentScreen);
  if (prevScreen !== currentScreen) {
    setPrevScreen(currentScreen);
    if (currentScreen === 'attendance' || currentScreen === 'payroll' || currentScreen === 'leave') setSubTab('attendance');
    else if (currentScreen === 'hr') setSubTab('overview');
  }

  useEffect(() => {
    refreshHrm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = useMemo(() => employees.filter((e) => e.status === 'active').length, [employees]);
  const monthRun = useMemo(() => payrollRuns.find((r) => r.month === currentMonthKey()), [payrollRuns]);

  const tabBadge = (id: Tab, active: boolean): React.ReactNode => {
    if (id === 'staff' && employees.length > 0)
      return (
        <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-extrabold rounded-full ${active ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {activeCount}
        </span>
      );
    if (id === 'attendance' && monthRun)
      return (
        <span
          className={`ml-1 w-2 h-2 rounded-full ${monthRun.status === 'paid' ? 'bg-emerald-500' : monthRun.status === 'finalized' ? 'bg-blue-500' : 'bg-slate-400'}`}
          title={`Tháng này: ${PAYROLL_STATUS_META[monthRun.status].label}`}
        />
      );
    return null;
  };

  return (
    <div id="hrm-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] bg-slate-100 overflow-hidden">
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center gap-3 shrink-0">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
          <Users className="w-5 h-5 text-blue-600" />
          Quản lý nhân sự
        </h2>
        <div className="ml-auto flex items-center gap-2 min-w-0">
          {/* Label đồng bộ đứng TRƯỚC cụm tab + giữ sẵn chỗ (visible/invisible) nên hiện/ẩn không xô tab */}
          <span
            className={`hidden md:flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0 ${hrmLoading ? 'visible' : 'invisible'}`}
            role="status"
            aria-live="polite"
          >
            <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-blue-500 animate-spin" aria-hidden="true" />
            Đang đồng bộ…
          </span>
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Chức năng nhân sự">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={subTab === t.id}
                onClick={() => setSubTab(t.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition cursor-pointer ${
                  subTab === t.id ? 'bg-blue-600 text-white shadow-xs font-semibold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {t.icon}
                {t.label}
                {tabBadge(t.id, subTab === t.id)}
              </button>
            ))}
          </div>
          {payrollLocks.includes(currentMonthKey()) && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-amber-300 shrink-0">
              <Lock className="w-3 h-3" /> Tháng này đã chốt
            </span>
          )}
        </div>
      </div>
      {hrmError && (
        <div className="mx-4 mt-2 flex items-start gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
          <span>{hrmError}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        {subTab === 'overview' && <OverviewTab />}
        {subTab === 'staff' && (
          <StaffTab
            employees={employees}
            accounts={accounts}
            isManager={isManager}
            isAdmin={isAdmin}
            onSave={saveEmployee}
            onCreateWithAccount={createEmployeeWithAccount}
            onCreateAccount={createAccountForEmployee}
            onResetPassword={resetEmployeePassword}
            onStatus={setEmployeeStatus}
          />
        )}
        {subTab === 'attendance' && (
          <AttendancePayrollTab
            employees={employees}
            attendanceDays={attendanceDays}
            payrollLocks={payrollLocks}
            payrollRuns={payrollRuns}
            payrollItems={payrollItems}
            advances={advances}
            payrollStaleMonths={payrollStaleMonths}
            isManager={isManager}
            onMark={markDay}
            onClear={clearDay}
            onGenerate={generatePayroll}
            onLockMonth={lockMonth}
            onReopen={reopenPayroll}
            onPay={payPayroll}
            onAddAdvance={addAdvance}
            onDeleteAdvance={deleteAdvance}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Tab Chấm công & Lương (chung 1 tháng) ----------
function AttendancePayrollTab({
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
      alert('Chưa có bảng lương để xuất!');
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
      alert('Chưa có bảng lương để in!');
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
                    alert(`Tháng ${monthKey} đã chi lương — không tạo lại được!`);
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

// ---------- Tab 1: Tổng quan ----------
function OverviewTab() {
  const { employees, attendanceDays, payrollRuns, profile, markDay, setCurrentScreen } = useStore();
  const isManager = profile?.role === 'admin' || profile?.role === 'manager';
  const now = new Date();
  const month = currentMonthKey();
  const [y, m] = month.split('-').map(Number);
  const days = useMemo(() => monthDays(y, m), [y, m]);
  const today = todayIso();
  const [markBusy, setMarkBusy] = useState<string | null>(null);

  const actives = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  const monthDaysList = useMemo(() => attendanceDays.filter((d) => d.work_date.startsWith(month)), [attendanceDays, month]);
  const totalDays = monthDaysList.reduce((s, d) => s + (ATTENDANCE_STATUS_META[d.status]?.days ?? 0), 0);
  const totalOt = monthDaysList.reduce((s, d) => s + (Number(d.ot_hours) || 0), 0);
  const run = payrollRuns.find((r) => r.month === month);
  const estimate = useMemo(() => {
    const byEmp = new Map<string, typeof monthDaysList>();
    for (const d of monthDaysList) {
      const list = byEmp.get(d.employee_id) || [];
      list.push(d);
      byEmp.set(d.employee_id, list);
    }
    return actives.reduce((s, e) => s + buildPayrollItem(e, byEmp.get(e.id) || []).net, 0);
  }, [actives, monthDaysList]);

  // Biểu đồ CSS: số người có công theo từng ngày
  const perDay = useMemo(() => {
    const presentSet = new Map<string, Set<string>>();
    const leaveSet = new Map<string, Set<string>>();
    for (const d of monthDaysList) {
      const key = d.work_date;
      if (d.status === 'leave_unpaid') {
        if (!leaveSet.has(key)) leaveSet.set(key, new Set());
        leaveSet.get(key)!.add(d.employee_id);
      } else {
        if (!presentSet.has(key)) presentSet.set(key, new Set());
        presentSet.get(key)!.add(d.employee_id);
      }
    }
    return { presentSet, leaveSet };
  }, [monthDaysList]);

  const maxHead = Math.max(1, actives.length);
  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name || '—';

  // Chỉ vẽ các ngày đã qua — ngày tương lai không hiện cột stub
  const elapsed = useMemo(() => days.filter((d) => d.iso <= today), [days, today]);
  const elapsedWork = useMemo(() => elapsed.filter((d) => HR_POLICY.workDays.includes(d.dow)), [elapsed]);
  const avgPerDay = elapsedWork.length > 0 ? Math.round((totalDays / elapsedWork.length) * 100) / 100 : 0;

  // Chấm công hôm nay: ai chưa có công
  const todayRecs = useMemo(() => {
    const m = new Map<string, (typeof attendanceDays)[number]>();
    for (const d of attendanceDays) {
      if (d.work_date === today) m.set(d.employee_id, d);
    }
    return m;
  }, [attendanceDays, today]);
  const missingToday = useMemo(() => actives.filter((e) => !todayRecs.has(e.id)), [actives, todayRecs]);
  const markedToday = actives.length - missingToday.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Đang làm việc"
          value={String(actives.length)}
          sub={`${employees.length} hồ sơ · ${employees.length - actives.length} nghỉ việc`}
          valueCls="text-slate-900"
          iconCls="bg-slate-800 text-white"
        />
        <StatCard
          icon={<ClipboardCheck className="w-5 h-5" />}
          label={`Công tháng ${month}`}
          value={String(Math.round(totalDays * 100) / 100)}
          sub={`${totalOt} giờ tăng ca`}
          valueCls="text-emerald-700"
          iconCls="bg-emerald-500 text-white"
        />
        <StatCard
          icon={<Banknote className="w-5 h-5" />}
          label="Quỹ lương tháng"
          value={formatVND(run ? run.total_net : estimate)}
          sub={run ? `Đã lập · ${PAYROLL_STATUS_META[run.status].label}` : 'Dự kiến từ bảng công'}
          valueCls="text-blue-700"
          iconCls="bg-blue-500 text-white"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className={`${CARD} p-4 xl:col-span-2`}>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-extrabold text-slate-800">Sĩ số chấm công tháng {month}</h3>
            <span className="ml-auto text-[11px] tabular-nums text-slate-500">
              Tổng <strong className="text-slate-800">{totalDays}</strong> công · <strong className="text-slate-800">{totalOt}h</strong> TC · BQ <strong className="text-slate-800">{avgPerDay}</strong>/ngày
            </span>
          </div>
          {actives.length === 0 ? (
            <EmptyState icon={<Users className="w-5 h-5" />} title="Chưa có nhân viên" hint="Thêm hồ sơ ở tab Nhân sự để bắt đầu chấm công." />
          ) : elapsed.length === 0 ? (
            <EmptyState icon={<CalendarDays className="w-5 h-5" />} title="Tháng này chưa bắt đầu" hint="Biểu đồ sẽ hiện khi sang ngày làm việc đầu tiên." />
          ) : (
            <>
              <div className="flex items-end gap-1 h-36 mt-3" role="img" aria-label={`Biểu đồ sĩ số chấm công tháng ${month}`}>
                {days.map((d) => {
                  const p = perDay.presentSet.get(d.iso)?.size || 0;
                  const l = perDay.leaveSet.get(d.iso)?.size || 0;
                  const h = Math.max(6, Math.round((p / maxHead) * 100));
                  const isToday = d.iso === today;
                  const isFuture = d.iso > today;
                  return (
                    <div
                      key={d.iso}
                      className="flex-1 flex flex-col min-w-0 h-full"
                      title={`${d.iso}: ${isFuture ? 'chưa đến ngày' : `${p} có công${l ? `, ${l} nghỉ không lương` : ''}`}`}
                    >
                      <span className={`h-4 text-[10px] font-extrabold tabular-nums leading-4 text-center ${p > 0 && !isFuture ? 'text-emerald-700' : 'text-transparent'}`}>
                        {p > 0 && !isFuture ? p : 0}
                      </span>
                      <div className="flex-1 flex items-end justify-center min-h-0">
                        {isFuture ? (
                          <div className="w-full max-w-9 rounded-t-md bg-slate-100" style={{ height: 3 }} />
                        ) : (
                          <div
                            className={`w-full max-w-9 rounded-t-md transition-all ${d.dow === 0 ? 'bg-slate-300' : p > 0 ? 'bg-emerald-500' : 'bg-slate-200'} ${
                              isToday ? 'ring-2 ring-amber-500 ring-offset-1' : ''
                            }`}
                            style={{ height: `${h}%` }}
                          />
                        )}
                      </div>
                      <span className={`h-4 text-[9px] tabular-nums leading-4 text-center ${isFuture ? 'text-slate-300' : d.dow === 0 ? 'text-rose-500 font-bold' : isToday ? 'text-amber-700 font-extrabold' : 'text-slate-400'}`}>
                        {d.d}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Có công
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-300" /> Chủ nhật
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm ring-2 ring-amber-500" /> Hôm nay
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-[3px] rounded-sm bg-slate-200" /> Chưa đến ngày
                </span>
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className={`${CARD} p-4`}>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-extrabold text-slate-800">Hôm nay · {today.slice(8)}/{today.slice(5, 7)}</h3>
              <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-500">
                <span className="text-emerald-700">{markedToday}</span>/{actives.length} đã chấm
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 mt-2 overflow-hidden" role="progressbar" aria-valuenow={markedToday} aria-valuemin={0} aria-valuemax={Math.max(1, actives.length)} aria-label="Tiến độ chấm công hôm nay">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${actives.length > 0 ? Math.round((markedToday / actives.length) * 100) : 0}%` }} />
            </div>
            {missingToday.length === 0 ? (
              <p className="text-xs text-emerald-700 font-bold mt-2 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Đủ công hôm nay.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                {missingToday.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                    <Avatar name={e.full_name} size="sm" />
                    <span className="text-xs font-bold text-slate-800 truncate flex-1">
                      {e.full_name} <span className="font-mono font-normal text-[10px] text-slate-400">{e.code}</span>
                    </span>
                    {isManager && (
                      <button
                        disabled={markBusy === e.id}
                        onClick={async () => {
                          setMarkBusy(e.id);
                          try {
                            await markDay({ employee_id: e.id, work_date: today, status: 'present' });
                          } finally {
                            setMarkBusy(null);
                          }
                        }}
                        className="px-2 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition disabled:opacity-50 cursor-pointer"
                        title={`Chấm Đi làm cho ${e.full_name} hôm nay`}
                      >
                        {markBusy === e.id ? '…' : 'Chấm P'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${CARD} p-4`}>
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-extrabold text-slate-800">Lương tháng {month}</h3>
              {run && (
                <span className={`ml-auto px-2 py-0.5 text-[11px] font-bold rounded-full border ${PAYROLL_STATUS_META[run.status].cls}`}>
                  {PAYROLL_STATUS_META[run.status].label}
                </span>
              )}
            </div>
            <div className="text-2xl font-extrabold tabular-nums text-slate-900 mt-1">{formatVND(run ? run.total_net : estimate)}</div>
            <div className="text-[11px] text-slate-400">{run ? `${run.headcount} người · đã lập bảng` : 'Dự kiến từ bảng công'}</div>
            {run && (
              <dl className="mt-2 space-y-1 text-xs border-t border-slate-100 pt-2">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Tổng công</dt>
                  <dd className="tabular-nums font-bold text-slate-800">{run.total_days}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Gross + phụ cấp</dt>
                  <dd className="tabular-nums font-bold text-slate-800">{formatVND(run.total_gross + run.total_allowance)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Tạm ứng đã trừ</dt>
                  <dd className="tabular-nums font-bold text-amber-700">{formatVND(run.total_advance)}</dd>
                </div>
              </dl>
            )}
            <button onClick={() => setCurrentScreen('payroll')} className={`${BTN_BLUE} w-full mt-3`}>
              {run ? 'Mở bảng lương' : 'Lập bảng lương'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Tab 2: Nhân sự ----------
function StaffTab({
  employees,
  accounts,
  isManager,
  isAdmin,
  onSave,
  onCreateWithAccount,
  onCreateAccount,
  onResetPassword,
  onStatus,
}: {
  employees: Employee[];
  accounts: HrmAccount[];
  isManager: boolean;
  isAdmin: boolean;
  onSave: (input: EmployeeInput) => Promise<boolean>;
  onCreateWithAccount: (emp: EmployeeInput, acct: { password: string; role: string }) => Promise<boolean>;
  onCreateAccount: (employeeId: string, acct: { password: string; role: string }) => Promise<boolean>;
  onResetPassword: (employeeId: string, newPassword: string) => Promise<boolean>;
  onStatus: (id: string, status: 'active' | 'inactive') => Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'daily' | 'monthly'>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const acctOf = (userId?: string) => (userId ? accounts.find((a) => a.id === userId) : undefined);
  const previewCode = useMemo(() => nextEmployeeCode(employees), [employees]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter((e) => (showInactive ? true : e.status === 'active'))
      .filter((e) => (typeFilter === 'all' ? true : e.salary_type === typeFilter))
      .filter((e) => !q || e.full_name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.phone || '').includes(q))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [employees, search, typeFilter, showInactive]);

  // ---- Xuất / Nhập / In Excel ----
  const staffToRow = (e: Employee): Record<string, unknown> => ({
    'Mã NV': e.code,
    'Họ tên *': e.full_name,
    'SĐT': e.phone || '',
    'Chức vụ': e.position || '',
    'Hình thức (daily/monthly)': e.salary_type,
    'Lương ngày': e.daily_wage,
    'Lương tháng': e.monthly_salary,
    'Phụ cấp': e.allowance_default,
    'Ngày vào làm': e.start_date || '',
    'Trạng thái': e.status === 'active' ? 'Đang làm' : 'Nghỉ việc',
  });

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('Không có dữ liệu để xuất!');
      return;
    }
    exportToExcel('nhan-su', [{ name: 'NhanSu', rows: list.map(staffToRow) }]);
  };

  const handlePrint = () => {
    if (list.length === 0) {
      alert('Không có dữ liệu để in!');
      return;
    }
    printTable({
      title: 'Danh sách nhân sự',
      meta: [`${list.length} người`],
      columns: [
        { header: 'Mã NV' },
        { header: 'Họ tên' },
        { header: 'SĐT' },
        { header: 'Chức vụ' },
        { header: 'Hình thức' },
        { header: 'Lương', align: 'right' },
        { header: 'Ngày vào làm' },
        { header: 'Trạng thái' },
      ],
      rows: list.slice(0, 1000).map((e) => [
        e.code,
        e.full_name,
        e.phone || '',
        e.position || '',
        e.salary_type === 'daily' ? 'Ngày' : 'Tháng',
        Math.round(e.salary_type === 'daily' ? e.daily_wage : e.monthly_salary).toLocaleString('vi-VN'),
        e.start_date || '',
        e.status === 'active' ? 'Đang làm' : 'Nghỉ việc',
      ]),
    });
  };

  const handleDownloadTemplate = () => {
    downloadExcelTemplate('nhan-su', ['Mã NV', 'Họ tên *', 'SĐT', 'Chức vụ', 'Hình thức (daily/monthly)', 'Lương ngày', 'Lương tháng', 'Phụ cấp', 'Ngày vào làm (YYYY-MM-DD)'], {
      'Mã NV': '',
      'Họ tên *': 'Nguyễn Văn A',
      'SĐT': '0901234567',
      'Chức vụ': 'Thợ',
      'Hình thức (daily/monthly)': 'daily',
      'Lương ngày': 300000,
      'Lương tháng': 0,
      'Phụ cấp': 20000,
      'Ngày vào làm (YYYY-MM-DD)': '2026-01-05',
    });
  };

  const handleImportExcel = async (file: File) => {
    setImporting(true);
    try {
      const { rows } = await readExcelFile(file);
      if (rows.length === 0) {
        alert('File không có dữ liệu!');
        return;
      }
      let created = 0;
      let updated = 0;
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const lineNo = i + 2;
        try {
          const full_name = (r['Họ tên *'] || r['Họ tên'] || '').trim();
          if (!full_name) throw new Error('thiếu Họ tên');
          const rawType = (r['Hình thức (daily/monthly)'] || r['Hình thức'] || 'daily').trim().toLowerCase();
          const salary_type = (rawType === 'monthly' || rawType === 'tháng' ? 'monthly' : 'daily') as 'daily' | 'monthly';
          const startRaw = (r['Ngày vào làm (YYYY-MM-DD)'] || r['Ngày vào làm'] || '').trim();
          const fields: EmployeeInput = {
            full_name,
            phone: (r['SĐT'] || '').trim() || undefined,
            position: (r['Chức vụ'] || '').trim() || undefined,
            salary_type,
            daily_wage: Math.max(0, Math.round(parseExcelNum(r['Lương ngày']))),
            monthly_salary: Math.max(0, Math.round(parseExcelNum(r['Lương tháng']))),
            allowance_default: Math.max(0, Math.round(parseExcelNum(r['Phụ cấp']))),
            start_date: /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : undefined,
          };
          const code = (r['Mã NV'] || '').trim();
          const existing =
            (code && employees.find((e) => e.code.toLowerCase() === code.toLowerCase())) ||
            employees.find((e) => e.full_name.toLowerCase() === full_name.toLowerCase() && (e.phone || '') === (fields.phone || ''));
          const ok = await onSave(existing ? { ...fields, id: existing.id } : fields);
          if (!ok) throw new Error('lưu thất bại');
          if (existing) updated++;
          else created++;
        } catch (err: any) {
          errors.push(`Dòng ${lineNo}: ${err?.message || 'lỗi không rõ'}`);
          if (errors.length >= 10) {
            errors.push('… (chỉ hiện 10 lỗi đầu)');
            break;
          }
        }
      }
      alert(`Nhập xong: ${created} tạo mới, ${updated} cập nhật (hồ sơ chưa gắn tài khoản — vào Sửa để tạo).${errors.length > 0 ? `\nLỗi:\n${errors.join('\n')}` : ''}`);
    } catch (err: any) {
      alert(`Đọc file thất bại: ${err?.message || err}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className={`${CARD} overflow-hidden flex flex-col`}>
        {/* Filter Bar — cùng khối với bảng (chuẩn Đơn hàng / Khách hàng / NCC) */}
        <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên / mã NV / SĐT…"
              aria-label="Tìm nhân viên"
              className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
            />
          </div>
        <div className="flex bg-slate-100 rounded-md p-0.5 gap-0.5" role="group" aria-label="Lọc hình thức lương">
          {(
            [
              ['all', 'Tất cả'],
              ['daily', 'Ngày'],
              ['monthly', 'Tháng'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTypeFilter(v)}
              aria-pressed={typeFilter === v}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition cursor-pointer ${typeFilter === v ? 'bg-white shadow-xs text-blue-700' : 'text-slate-700 hover:bg-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="w-4 h-4 accent-blue-600 cursor-pointer"
          />
          Hiện nghỉ việc
        </label>
        <span className="text-xs text-slate-400 tabular-nums">{list.length} người</span>
        <TableTools
          onExportExcel={handleExportExcel}
          onPrint={handlePrint}
          onImportExcel={isManager ? handleImportExcel : undefined}
          onDownloadTemplate={isManager ? handleDownloadTemplate : undefined}
          importing={importing}
        />
        {isManager && (
          <button onClick={() => setEditing('new')} className={`${BTN_P} ml-auto`}>
            <Plus className="w-4 h-4" /> Thêm nhân viên
          </button>
        )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1180px]">
          <thead className="bg-slate-50/80">
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                <th className={TH}>Nhân viên</th>
              <th className={TH}>Mã NV</th>
              <th className={TH}>SĐT</th>
              <th className={TH}>Chức vụ</th>
              <th className={TH}>Hình thức</th>
              <th className={`${TH} text-right`}>Lương</th>
              <th className={`${TH} text-right`}>Phụ cấp</th>
              <th className={TH}>Ngày vào làm</th>
              <th className={TH}>Trạng thái</th>
              {isManager && <th className={`${TH} text-right`}>Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={e.full_name} />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 leading-tight">{e.full_name}</div>
                      <div className="text-xs leading-tight mt-0.5">
                        {e.user_id ? (
                          <span className="text-emerald-700 font-bold">TK: {e.code}</span>
                        ) : (
                          <span className="px-1.5 py-px bg-amber-100 text-amber-800 rounded-md font-bold">Chưa có tài khoản</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="font-mono text-xs font-bold text-blue-700">{e.code}</span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-700">{e.phone || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className="px-2 py-0.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 whitespace-nowrap">
                    {e.position || '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded-full border whitespace-nowrap ${e.salary_type === 'daily' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
                  >
                    {e.salary_type === 'daily' ? 'Lương ngày' : 'Lương tháng'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <div className="tabular-nums font-bold text-slate-800">{formatVND(e.salary_type === 'daily' ? e.daily_wage : e.monthly_salary)}</div>
                  <div className="text-[10px] font-normal text-slate-400">{e.salary_type === 'daily' ? 'đ/ngày' : 'đ/tháng'}</div>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <div className="tabular-nums text-slate-600">{e.allowance_default ? formatVND(e.allowance_default) : '—'}</div>
                  {e.allowance_default > 0 && <div className="text-[10px] font-normal text-slate-400">{e.salary_type === 'daily' ? 'đ/ngày' : 'đ/tháng'}</div>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="tabular-nums font-bold text-slate-800">{toDMY(e.start_date)}</div>
                  <div className="text-[11px] text-slate-400">{e.start_date ? `Thâm niên ${seniority(e.start_date)}` : ''}</div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
                    <span className={`w-1.5 h-1.5 rounded-full ${e.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
                    <span className={e.status === 'active' ? 'text-emerald-700' : 'text-slate-500'}>
                      {e.status === 'active' ? 'Đang làm' : 'Nghỉ việc'}
                    </span>
                  </span>
                </td>
                {isManager && (
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(e)}
                      className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                      title="Sửa hồ sơ, tài khoản & trạng thái"
                      aria-label={`Sửa hồ sơ ${e.full_name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    icon={<Users className="w-5 h-5" />}
                    title="Chưa có nhân viên phù hợp"
                    hint={search ? 'Thử từ khóa khác hoặc xóa bộ lọc.' : 'Bấm “Thêm nhân viên” để tạo hồ sơ đầu tiên.'}
                  />
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EmployeeForm
          initial={editing === 'new' ? undefined : editing}
          accounts={accounts}
          previewCode={previewCode}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await onSave(v);
            if (ok) setEditing(null);
            return ok;
          }}
          onCreateWithAccount={async (emp, acct) => {
            const ok = await onCreateWithAccount(emp, acct);
            if (ok) setEditing(null);
            return ok;
          }}
          onCreateAccount={async (employeeId, acct) => {
            const ok = await onCreateAccount(employeeId, acct);
            if (ok) setEditing(null);
            return ok;
          }}
          onResetPassword={onResetPassword}
          onStatus={async (id, st) => {
            const ok = await onStatus(id, st);
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}

// Modal thêm/sửa hồ sơ: gom nhóm theo section, lỗi hiện ngay dưới ô
function EmployeeForm({
  initial,
  accounts,
  previewCode,
  isAdmin,
  onClose,
  onSave,
  onCreateWithAccount,
  onCreateAccount,
  onResetPassword,
  onStatus,
}: {
  initial?: Employee;
  accounts: HrmAccount[];
  previewCode: string;
  isAdmin: boolean;
  onClose: () => void;
  onSave: (v: EmployeeInput) => Promise<boolean>;
  onCreateWithAccount: (emp: EmployeeInput, acct: { password: string; role: string }) => Promise<boolean>;
  onCreateAccount: (employeeId: string, acct: { password: string; role: string }) => Promise<boolean>;
  onResetPassword: (employeeId: string, newPassword: string) => Promise<boolean>;
  onStatus: (id: string, status: 'active' | 'inactive') => Promise<boolean>;
}) {
  const [fullName, setFullName] = useState(initial?.full_name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [position, setPosition] = useState(initial?.position || '');
  const [salaryType, setSalaryType] = useState<'daily' | 'monthly'>(initial?.salary_type || 'daily');
  const [dailyWage, setDailyWage] = useState(initial?.daily_wage || 0);
  const [monthlySalary, setMonthlySalary] = useState(initial?.monthly_salary || 0);
  const [allowance, setAllowance] = useState(initial?.allowance_default || 0);
  const [startDate, setStartDate] = useState(initial?.start_date || todayIso());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const linkedAcct = initial?.user_id ? accounts.find((a) => a.id === initial.user_id) : undefined;
  const [acctPassword, setAcctPassword] = useState('');
  const [acctRole, setAcctRole] = useState('cashier');
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'active' | 'inactive'>(initial?.status || 'active');
  const roleOptions = isAdmin ? ['admin', 'manager', 'cashier', 'worker'] : ['cashier', 'worker'];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const setErr = (k: string, msg: string) => setErrors((p) => ({ ...p, [k]: msg }));

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Nhập họ tên nhân viên.';
    if (!position) errs.position = 'Chọn chức vụ.';
    if (!initial && acctPassword.trim().length < 6) errs.acctPassword = 'Mật khẩu từ 6 ký tự trở lên.';
    if (initial && !initial.user_id && acctPassword && acctPassword.trim().length < 6)
      errs.acctPassword = 'Mật khẩu từ 6 ký tự trở lên (bỏ trống = chỉ lưu hồ sơ).';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const fields: EmployeeInput = {
        id: initial?.id,
        full_name: fullName.trim(),
        phone: phone.trim(),
        position,
        salary_type: salaryType,
        daily_wage: dailyWage,
        monthly_salary: monthlySalary,
        allowance_default: allowance,
        start_date: startDate || undefined,
      };
      if (!initial) {
        await onCreateWithAccount(fields, { password: acctPassword.trim(), role: acctRole });
      } else if (!initial.user_id && acctPassword) {
        const ok = await onCreateAccount(initial.id, { password: acctPassword.trim(), role: acctRole });
        if (ok) await onSave(fields);
      } else {
        await onSave(fields);
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (k: string) => (errors[k] ? <p className="text-xs text-rose-600 font-bold mt-1">{errors[k]}</p> : null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={initial ? 'Sửa hồ sơ nhân viên' : 'Thêm nhân viên'}>
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2.5 shrink-0">
          {initial ? (
            <Avatar name={initial.full_name} size="sm" />
          ) : (
            <span className="font-mono font-extrabold text-xs bg-white/15 rounded px-1.5 py-0.5">{previewCode}</span>
          )}
          <h3 className="font-bold text-sm truncate">{initial ? `Sửa hồ sơ — ${initial.full_name}` : 'Thêm nhân viên'}</h3>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white transition cursor-pointer" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          <section>
            <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">Thông tin chung</h4>
            <div className="space-y-3">
              <div>
                <label htmlFor="emp-name" className="text-xs font-semibold text-slate-700">
                  Họ tên <span className="text-rose-500">*</span>
                </label>
                <input
                  id="emp-name"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (errors.fullName) setErr('fullName', '');
                  }}
                  placeholder="Nguyễn Văn A"
                  autoFocus={!initial}
                  className={`${INPUT} ${errors.fullName ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                />
                {fieldErr('fullName')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="emp-phone" className="text-xs font-semibold text-slate-700">
                    SĐT
                  </label>
                  <input id="emp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx…" className={INPUT} />
                </div>
                <div>
                  <label htmlFor="emp-position" className="text-xs font-semibold text-slate-700">
                    Chức vụ <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="emp-position"
                    value={position}
                    onChange={(e) => {
                      setPosition(e.target.value);
                      if (errors.position) setErr('position', '');
                    }}
                    className={`${INPUT} ${errors.position ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                  >
                    <option value="">— Chọn —</option>
                    {(initial?.position && !POSITION_OPTIONS.includes(initial.position)
                      ? [initial.position, ...POSITION_OPTIONS]
                      : POSITION_OPTIONS
                    ).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {fieldErr('position')}
                </div>
              </div>
              <div>
                <label htmlFor="emp-start" className="text-xs font-semibold text-slate-700">
                  Ngày vào làm
                </label>
                <input id="emp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} />
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">Lương & phụ cấp</h4>
            <div className="space-y-3">
              <div>
                <span className="text-xs font-semibold text-slate-700" id="salary-type-label">
                  Hình thức lương
                </span>
                <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1 mt-1" role="group" aria-labelledby="salary-type-label">
                  {(
                    [
                      ['daily', 'Lương ngày'],
                      ['monthly', 'Lương tháng'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSalaryType(v)}
                      aria-pressed={salaryType === v}
                      className={`py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${salaryType === v ? 'bg-white shadow-sm text-amber-700' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="emp-wage" className="text-xs font-semibold text-slate-700">
                    {salaryType === 'daily' ? 'Lương ngày (đ)' : 'Lương tháng (đ)'}
                  </label>
                  {salaryType === 'daily' ? (
                    <NumberInput id="emp-wage" value={dailyWage} min={0} onChange={setDailyWage} placeholder="0" className={`${INPUT} tabular-nums`} />
                  ) : (
                    <NumberInput id="emp-wage" value={monthlySalary} min={0} onChange={setMonthlySalary} placeholder="0" className={`${INPUT} tabular-nums`} />
                  )}
                </div>
                <div>
                  <label htmlFor="emp-allow" className="text-xs font-semibold text-slate-700">
                    Phụ cấp {salaryType === 'daily' ? '/ngày' : '/tháng'} (đ)
                  </label>
                  <NumberInput id="emp-allow" value={allowance} min={0} onChange={setAllowance} placeholder="0" className={`${INPUT} tabular-nums`} />
                </div>
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">Tài khoản đăng nhập</h4>
          {initial ? (
            linkedAcct ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2.5">
                <p className="text-sm font-bold text-emerald-700">✓ Mã đăng nhập: {initial.code}</p>
                <div>
                  <label htmlFor="emp-newpw" className="text-xs font-semibold text-slate-700">
                    Đặt lại mật khẩu
                  </label>
                  <div className="flex gap-2 mt-1">
                    <input
                      id="emp-newpw"
                      type="password"
                      value={newPw}
                      onChange={(e) => {
                        setNewPw(e.target.value);
                        if (errors.newPw) setErr('newPw', '');
                      }}
                      placeholder="Mật khẩu mới (≥6 ký tự)"
                      className={`flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white ${errors.newPw ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                    />
                    <button
                      disabled={pwBusy}
                      onClick={async () => {
                        if (newPw.trim().length < 6) {
                          setErr('newPw', 'Mật khẩu từ 6 ký tự trở lên.');
                          return;
                        }
                        if (!(await confirmDialog(`Đổi mật khẩu ${initial.code}? NV dùng mật khẩu mới từ lần đăng nhập sau.`, { title: 'Đổi mật khẩu', confirmLabel: 'Đổi mật khẩu' }))) return;
                        setPwBusy(true);
                        try {
                          const ok = await onResetPassword(initial.id, newPw.trim());
                          if (ok) setNewPw('');
                        } finally {
                          setPwBusy(false);
                        }
                      }}
                      className="shrink-0 px-3 py-2 text-xs font-bold text-blue-700 border border-blue-300 hover:bg-blue-50 rounded-xl transition disabled:opacity-50 cursor-pointer"
                    >
                      {pwBusy ? 'Đang đổi…' : 'Đổi MK'}
                    </button>
                  </div>
                  {fieldErr('newPw')}
                </div>
              </div>
            ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
                  <p className="text-xs text-amber-800 font-bold">Hồ sơ {initial.code} chưa có tài khoản — đặt mật khẩu để tạo.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="emp-pw" className="text-xs font-semibold text-slate-700">
                        Mật khẩu (≥6 ký tự)
                      </label>
                      <input
                        id="emp-pw"
                        type="password"
                        value={acctPassword}
                        onChange={(e) => {
                          setAcctPassword(e.target.value);
                          if (errors.acctPassword) setErr('acctPassword', '');
                        }}
                        className={`${INPUT} ${errors.acctPassword ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                      />
                      {fieldErr('acctPassword')}
                    </div>
                    <div>
                      <label htmlFor="emp-role" className="text-xs font-semibold text-slate-700">
                        Quyền
                      </label>
                      <select id="emp-role" value={acctRole} onChange={(e) => setAcctRole(e.target.value)} className={INPUT}>
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                <p className="text-xs text-slate-600">
                  Mã NV <strong className="font-mono text-amber-700">{previewCode}</strong> — NV dùng mã này + mật khẩu để đăng nhập.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="emp-pw" className="text-xs font-semibold text-slate-700">
                      Mật khẩu <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="emp-pw"
                      type="password"
                      value={acctPassword}
                      onChange={(e) => {
                        setAcctPassword(e.target.value);
                        if (errors.acctPassword) setErr('acctPassword', '');
                      }}
                      className={`${INPUT} ${errors.acctPassword ? 'border-rose-400 ring-2 ring-rose-100' : ''}`}
                    />
                    {fieldErr('acctPassword')}
                  </div>
                  <div>
                    <label htmlFor="emp-role" className="text-xs font-semibold text-slate-700">
                      Quyền
                    </label>
                    <select id="emp-role" value={acctRole} onChange={(e) => setAcctRole(e.target.value)} className={INPUT}>
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {!isAdmin && <p className="text-[11px] text-slate-500">Quản lý chỉ tạo được Thu ngân / Thợ.</p>}
              </div>
            )}
          </section>

          {initial && (
            <section>
              <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">Trạng thái làm việc</h4>
              <div
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${liveStatus === 'active' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-100 border-slate-200'}`}
              >
                <span className={`w-2 h-2 rounded-full ${liveStatus === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
                <span className={`text-sm font-bold ${liveStatus === 'active' ? 'text-emerald-800' : 'text-slate-500'}`}>
                  {liveStatus === 'active' ? 'Đang làm việc' : 'Đã nghỉ việc'}
                </span>
                {liveStatus === 'active' ? (
                  <button
                    onClick={async () => {
                      if (!(await confirmDialog(`Cho ${initial.code} – ${initial.full_name} nghỉ việc? (Giữ lại lịch sử công/lương)`, { title: 'Cho nghỉ việc', confirmLabel: 'Cho nghỉ việc' }))) return;
                      const ok = await onStatus(initial.id, 'inactive');
                      if (ok) setLiveStatus('inactive');
                    }}
                    className="ml-auto px-3 py-1.5 text-xs font-bold text-rose-700 border border-rose-300 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                  >
                    Cho nghỉ việc
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      const ok = await onStatus(initial.id, 'active');
                      if (ok) setLiveStatus('active');
                    }}
                    className="ml-auto px-3 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-300 hover:bg-emerald-100 rounded-lg transition cursor-pointer"
                  >
                    Đi làm lại
                  </button>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="px-3 py-2.5 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded transition cursor-pointer">
            Hủy
          </button>
          <button onClick={handleSave} disabled={busy} className="px-4 py-1.5 text-white rounded text-xs font-bold shadow-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition cursor-pointer">
            {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Tab 3: Chấm công ----------
const CYCLE: (AttendanceStatus | null)[] = ['present', 'half', 'leave_paid', 'leave_unpaid', 'holiday', null];
const KEY_TO_STATUS: Record<string, AttendanceStatus> = { '1': 'present', '2': 'half', '3': 'leave_paid', '4': 'leave_unpaid', '5': 'holiday' };

function AttendanceTab({
  employees,
  attendanceDays,
  payrollLocks,
  isManager,
  year,
  month,
  onMonthChange,
  onMark,
  onClear,
}: {
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  payrollLocks: string[];
  isManager: boolean;
  year: number;
  month: number;
  onMonthChange: (y: number, m: number) => void;
  onMark: (input: { employee_id: string; work_date: string; status: AttendanceStatus; ot_hours?: number; note?: string }) => Promise<boolean>;
  onClear: (id: string) => Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const [hideMarked, setHideMarked] = useState(false);
  const [sel, setSel] = useState<{ empId: string; iso: string } | null>(null);
  const [ot, setOt] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const days = useMemo(() => monthDays(year, month), [year, month]);
  const locked = payrollLocks.includes(monthKey);
  const today = todayIso();
  const workIsos = useMemo(() => days.filter((d) => HR_POLICY.workDays.includes(d.dow)).map((d) => d.iso), [days]);

  const cellMap = useMemo(() => {
    const m = new Map<string, (typeof attendanceDays)[number]>();
    for (const d of attendanceDays) {
      if (d.work_date.startsWith(monthKey)) m.set(`${d.employee_id}:${d.work_date}`, d);
    }
    return m;
  }, [attendanceDays, monthKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter((e) => e.status === 'active')
      .filter((e) => !q || e.full_name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q))
      .filter((e) => {
        if (!hideMarked) return true;
        return workIsos.some((iso) => !cellMap.get(`${e.id}:${iso}`));
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [employees, search, hideMarked, workIsos, cellMap]);

  const rowTotals = useMemo(() => {
    const m = new Map<string, { days: number; ot: number }>();
    for (const e of rows) {
      let d = 0;
      let otH = 0;
      for (const iso of workIsos) {
        const rec = cellMap.get(`${e.id}:${iso}`);
        if (rec) {
          d += ATTENDANCE_STATUS_META[rec.status]?.days ?? 0;
          otH += Number(rec.ot_hours) || 0;
        }
      }
      // cộng cả ngày ngoài lịch chuẩn (nếu có chấm lẻ)
      for (const [key, rec] of cellMap) {
        if (key.startsWith(`${e.id}:`) && !workIsos.includes(rec.work_date)) {
          d += ATTENDANCE_STATUS_META[rec.status]?.days ?? 0;
          otH += Number(rec.ot_hours) || 0;
        }
      }
      m.set(e.id, { days: Math.round(d * 100) / 100, ot: Math.round(otH * 100) / 100 });
    }
    return m;
  }, [rows, workIsos, cellMap]);

  const monthTotal = useMemo(() => {
    let d = 0;
    let otH = 0;
    for (const t of rowTotals.values()) {
      d += t.days;
      otH += t.ot;
    }
    return { days: Math.round(d * 100) / 100, ot: Math.round(otH * 100) / 100 };
  }, [rowTotals]);

  const selRec = sel ? cellMap.get(`${sel.empId}:${sel.iso}`) : undefined;
  const selEmp = sel ? employees.find((e) => e.id === sel.empId) : undefined;

  // Nạp OT/ghi chú của ô đang chọn bằng "adjust state during render" (tránh setState
  // trong effect — react-hooks/set-state-in-effect).
  const [prevSelKey, setPrevSelKey] = useState<string | undefined>(undefined);
  if (prevSelKey !== selRec?.id) {
    setPrevSelKey(selRec?.id);
    setOt(selRec?.ot_hours || 0);
    setNote(selRec?.note || '');
  }

  const cycleCell = async (empId: string, iso: string) => {
    if (!isManager || locked || busy) return;
    const cur = cellMap.get(`${empId}:${iso}`);
    const next = CYCLE[(CYCLE.indexOf(cur?.status ?? null) + 1) % CYCLE.length];
    setBusy(true);
    try {
      if (next === null) {
        if (cur) await onClear(cur.id);
      } else {
        await onMark({ employee_id: empId, work_date: iso, status: next, ot_hours: cur?.ot_hours || 0, note: cur?.note });
      }
    } finally {
      setBusy(false);
    }
  };

  const fillRowPresent = async () => {
    if (!selEmp || !isManager || locked || filling) return;
    const missing = workIsos.filter((iso) => !cellMap.get(`${selEmp.id}:${iso}`));
    if (missing.length === 0) {
      alert(`${selEmp.full_name} đã đủ công các ngày làm việc trong tháng.`);
      return;
    }
    if (!(await confirmDialog(`Chấm "Đi làm" cho ${missing.length} ngày trống của ${selEmp.full_name} trong T${month}?`, { title: 'Chấm nhanh', confirmLabel: 'Chấm hết', danger: false }))) return;
    setFilling(true);
    try {
      for (const iso of missing) {
        await onMark({ employee_id: selEmp.id, work_date: iso, status: 'present' });
      }
    } finally {
      setFilling(false);
    }
  };

  const moveSel = (dRow: number, dCol: number) => {
    if (rows.length === 0 || days.length === 0) return;
    const curR = sel ? rows.findIndex((e) => e.id === sel.empId) : 0;
    const curC = sel ? days.findIndex((d) => d.iso === sel.iso) : 0;
    const r = Math.min(rows.length - 1, Math.max(0, (curR < 0 ? 0 : curR) + dRow));
    const c = Math.min(days.length - 1, Math.max(0, (curC < 0 ? 0 : curC) + dCol));
    setSel({ empId: rows[r].id, iso: days[c].iso });
  };

  const handleGridKey = async (e: React.KeyboardEvent) => {
    if (!isManager || locked || busy || filling) return;
    if (!sel) {
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        setSel({ empId: rows[0]?.id || '', iso: days[0]?.iso || '' });
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSel(1, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSel(-1, 0);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveSel(0, 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveSel(0, -1);
    } else if (KEY_TO_STATUS[e.key]) {
      e.preventDefault();
      const cur = cellMap.get(`${sel.empId}:${sel.iso}`);
      await onMark({ employee_id: sel.empId, work_date: sel.iso, status: KEY_TO_STATUS[e.key], ot_hours: cur?.ot_hours || 0, note: cur?.note });
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const cur = cellMap.get(`${sel.empId}:${sel.iso}`);
      if (cur) await onClear(cur.id);
    }
  };

  const gotoToday = () => {
    const t = new Date();
    onMonthChange(t.getFullYear(), t.getMonth() + 1);
  };

  // ---- Xuất Excel / In bảng công tháng ----
  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('Không có dữ liệu để xuất!');
      return;
    }
    exportToExcel(`cham-cong-${monthKey}`, [
      {
        name: 'ChamCong',
        rows: rows.map((e) => {
          const rec: Record<string, unknown> = { 'Mã NV': e.code, 'Họ tên': e.full_name };
          for (const d of days) {
            const r = cellMap.get(`${e.id}:${d.iso}`);
            rec[String(d.d)] = r ? `${ATTENDANCE_STATUS_META[r.status]?.short ?? ''}${Number(r.ot_hours) > 0 ? `+${r.ot_hours}h` : ''}` : '';
          }
          const t = rowTotals.get(e.id) || { days: 0, ot: 0 };
          rec['Tổng công'] = t.days;
          rec['Tăng ca (giờ)'] = t.ot;
          return rec;
        }),
      },
    ]);
  };

  const handlePrint = () => {
    if (rows.length === 0) {
      alert('Không có dữ liệu để in!');
      return;
    }
    printTable({
      title: `Bảng chấm công tháng ${monthKey}`,
      meta: [`${rows.length} nhân viên`, `Tổng: ${monthTotal.days} công · ${monthTotal.ot}h tăng ca${locked ? ' · ĐÃ CHỐT' : ''}`],
      columns: [
        { header: 'Mã NV' },
        { header: 'Họ tên' },
        ...days.map((d) => ({ header: String(d.d), align: 'center' as const })),
        { header: 'Tổng', align: 'right' as const },
      ],
      rows: rows.slice(0, 200).map((e) => {
        const cells: (string | number)[] = [e.code, e.full_name];
        for (const d of days) {
          const r = cellMap.get(`${e.id}:${d.iso}`);
          cells.push(r ? `${ATTENDANCE_STATUS_META[r.status]?.short ?? ''}${Number(r.ot_hours) > 0 ? `+${r.ot_hours}` : ''}` : '');
        }
        const t = rowTotals.get(e.id) || { days: 0, ot: 0 };
        cells.push(t.days);
        return cells;
      }),
    });
  };

  return (
    <div className="space-y-3">
      <div className={`${CARD} overflow-hidden flex flex-col`}>
        {/* Toolbar — tiêu đề trái, bộ lọc phải (chuẩn khối bảng lương) */}
        <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold text-slate-800">Chấm công tháng {monthKey}</h3>
          <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5">
          <button
            onClick={() => {
              const d = new Date(year, month - 2, 1);
              onMonthChange(d.getFullYear(), d.getMonth() + 1);
            }}
            className="p-1.5 rounded hover:bg-white transition cursor-pointer"
            aria-label="Tháng trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-bold text-slate-800 min-w-[86px] text-center text-xs tabular-nums">
            T{month}/{year}
          </span>
          <button
            onClick={() => {
              const d = new Date(year, month, 1);
              onMonthChange(d.getFullYear(), d.getMonth() + 1);
            }}
            className="p-1.5 rounded hover:bg-white transition cursor-pointer"
            aria-label="Tháng sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button onClick={gotoToday} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-blue-700 border border-slate-300 hover:border-blue-400 rounded-md px-2 h-8 transition cursor-pointer">
          <CalendarDays className="w-3.5 h-3.5" /> Hôm nay
        </button>
        <div className="relative flex-1 min-w-[150px] sm:flex-none sm:w-52">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm nhân viên…" aria-label="Tìm nhân viên" className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden" />
        </div>
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={hideMarked} onChange={(e) => setHideMarked(e.target.checked)} className="w-4 h-4 accent-blue-600 cursor-pointer" />
          Chỉ hiện chưa đủ công
        </label>
        <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
        {locked && (
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold bg-slate-800 text-amber-300" title="Đã chốt ở mục lương bên dưới — bấm Mở lại để chấm/sửa">
            <Lock className="w-3.5 h-3.5" /> Đã chốt {monthKey}
          </span>
        )}
          </div>
        </div>

        <div
          className="overflow-auto hrm-matrix max-h-[58vh] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        tabIndex={0}
        role="grid"
        aria-label={`Bảng chấm công tháng ${month} năm ${year}. Dùng phím mũi tên để di chuyển, phím 1 đến 5 để đổi trạng thái.`}
        onKeyDown={handleGridKey}
      >
        <table className="border-collapse text-xs min-w-max w-full">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-30 bg-slate-50 border-b border-r border-slate-200 px-2.5 py-2 text-left min-w-[168px] text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Nhân viên
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  className={`border-b border-slate-200 px-1 py-2 min-w-[36px] tabular-nums ${
                    d.iso === today ? 'bg-amber-100 text-amber-800' : d.dow === 0 ? 'bg-rose-50 text-rose-600' : 'text-slate-500'
                  }`}
                >
                  {d.d}
                </th>
              ))}
              <th className="sticky right-0 z-30 bg-slate-50 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[104px] text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Tổng
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const t = rowTotals.get(e.id) || { days: 0, ot: 0 };
              return (
                <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="sticky left-0 z-10 bg-white border-r border-slate-200 px-2.5 py-1">
                    <button
                      onClick={() => setSel({ empId: e.id, iso: sel?.empId === e.id ? sel.iso : today.startsWith(monthKey) ? today : days[0]?.iso || '' })}
                      className="flex items-center gap-2 w-full text-left rounded-lg px-1 py-0.5 hover:bg-slate-100 transition cursor-pointer"
                      title="Chọn nhân viên để xem chi tiết"
                    >
                      <Avatar name={e.full_name} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-bold text-slate-800 truncate leading-tight">{e.full_name}</span>
                        <span className="block font-mono text-[10px] text-slate-400 leading-tight">{e.code}</span>
                      </span>
                    </button>
                  </td>
                  {days.map((d) => {
                    const rec = cellMap.get(`${e.id}:${d.iso}`);
                    const isSel = sel?.empId === e.id && sel?.iso === d.iso;
                    const isToday = d.iso === today;
                    return (
                      <td
                        key={d.iso}
                        className={`text-center p-0.5 border-b border-slate-100 ${d.dow === 0 ? 'bg-rose-50/40' : ''} ${isToday ? 'bg-amber-50/60' : ''} ${
                          isSel ? 'outline-2 outline-blue-500 outline -outline-offset-2' : ''
                        }`}
                      >
                        <button
                          disabled={!isManager || locked}
                          onClick={() => {
                            setSel({ empId: e.id, iso: d.iso });
                            cycleCell(e.id, d.iso);
                          }}
                          title={`${e.full_name} — ${d.iso}${rec ? `: ${ATTENDANCE_STATUS_META[rec.status]?.label ?? ''}${rec.ot_hours ? ` +${rec.ot_hours}h TC` : ''}${rec.note ? ` (${rec.note})` : ''}` : ': chưa chấm'}`}
                          aria-label={`${e.full_name} ngày ${d.iso}: ${rec ? ATTENDANCE_STATUS_META[rec.status]?.label : 'chưa chấm'}`}
                          className={`w-8 h-8 rounded-md font-extrabold transition cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            rec ? STATUS_STYLE[rec.status] + ' shadow-sm' : 'text-slate-300 hover:bg-slate-200 hover:text-slate-500'
                          } ${!isManager || locked ? 'cursor-default' : ''}`}
                        >
                          {rec ? (
                            <span className="leading-none">
                              {ATTENDANCE_STATUS_META[rec.status]?.short ?? '?'}
                              {rec.ot_hours > 0 && <span className="block text-[8px] leading-tight opacity-90">+{rec.ot_hours}h</span>}
                            </span>
                          ) : (
                            '·'
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-white border-b border-l border-slate-200 px-2 py-1 text-right tabular-nums whitespace-nowrap">
                    <span className="font-extrabold text-slate-800">{t.days}</span>
                    <span className="text-slate-400"> công</span>
                    {t.ot > 0 && <span className="block text-[10px] font-bold text-amber-700">+{t.ot}h TC</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={40}>
                  <EmptyState icon={<Users className="w-5 h-5" />} title="Chưa có nhân viên" hint="Thêm hồ sơ ở tab Nhân sự hoặc xóa bộ lọc." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">Chú thích:</span>
        {(Object.keys(ATTENDANCE_STATUS_META) as AttendanceStatus[]).map((st) => (
          <span key={st} className="inline-flex items-center gap-1">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-extrabold ${STATUS_STYLE[st]}`}>
              {ATTENDANCE_STATUS_META[st].short}
            </span>
            {ATTENDANCE_STATUS_META[st].label}
          </span>
        ))}
        {isManager && !locked && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Keyboard className="w-3.5 h-3.5" />
            Click ô để đổi · phím <Kbd>←→↑↓</Kbd> di chuyển · <Kbd>1</Kbd>–<Kbd>5</Kbd> đổi trạng thái · <Kbd>⌫</Kbd> xóa
          </span>
        )}
        <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-600">
          Tổng tháng: {monthTotal.days} công{monthTotal.ot > 0 ? ` · ${monthTotal.ot}h TC` : ''}
          {locked ? ' · đã chốt' : ''}
        </span>
      </div>

      {sel && selEmp && (
        <div className={`${CARD} p-3.5`}>
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={selEmp.full_name} size="lg" />
            <div className="min-w-0">
              <div className="font-extrabold text-slate-900 leading-tight">
                {selEmp.full_name} <span className="font-mono font-normal text-xs text-slate-400">{selEmp.code}</span>
              </div>
              <div className="text-xs text-slate-500 tabular-nums">
                Ngày {sel.iso}
                {selRec && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded-md border text-[11px] font-bold ${STATUS_CHIP[selRec.status]}`}>
                    {ATTENDANCE_STATUS_META[selRec.status]?.label}
                  </span>
                )}
              </div>
            </div>
            {isManager && !locked && (
              <button
                onClick={fillRowPresent}
                disabled={filling}
                className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 border border-emerald-300 hover:bg-emerald-50 rounded-md px-2.5 h-8 transition disabled:opacity-50 cursor-pointer"
                title="Chấm “Đi làm” cho mọi ngày làm việc còn trống của người này trong tháng"
              >
                <Check className="w-3.5 h-3.5" /> {filling ? 'Đang chấm…' : 'Chấm P ngày trống'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-1.5 mt-3" role="group" aria-label="Chọn trạng thái ngày công">
            {ATTENDANCE_STATUS_ORDER.map((st, i) => (
              <button
                key={st}
                disabled={!isManager || locked}
                onClick={() => onMark({ employee_id: sel.empId, work_date: sel.iso, status: st, ot_hours: ot, note })}
                className={`rounded-lg py-2 font-extrabold transition cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 disabled:cursor-default ${
                  selRec?.status === st ? STATUS_STYLE[st] + ' ring-2 ring-blue-500 ring-offset-1 shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={`${ATTENDANCE_STATUS_META[st].label} (phím ${i + 1})`}
              >
                <span className="block text-sm leading-none">{ATTENDANCE_STATUS_META[st].short}</span>
                <span className="block text-[9px] font-bold mt-0.5 opacity-90">{ATTENDANCE_STATUS_META[st].label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2 mt-3">
            <div>
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Tăng ca (giờ)
              </span>
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => setOt((v) => Math.max(0, Math.round((v - 0.5) * 10) / 10))}
                  disabled={!isManager || locked}
                  className="w-8 h-8 rounded-md border border-slate-300 font-extrabold hover:bg-slate-100 transition disabled:opacity-40 cursor-pointer"
                  aria-label="Giảm tăng ca"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={ot}
                  onChange={(e) => setOt(Math.max(0, Number(e.target.value) || 0))}
                  disabled={!isManager || locked}
                  aria-label="Số giờ tăng ca"
                  className="w-16 h-8 border border-slate-300 rounded-md px-2 text-xs tabular-nums text-center"
                />
                <button
                  onClick={() => setOt((v) => Math.round((v + 0.5) * 10) / 10)}
                  disabled={!isManager || locked}
                  className="w-8 h-8 rounded-md border border-slate-300 font-extrabold hover:bg-slate-100 transition disabled:opacity-40 cursor-pointer"
                  aria-label="Tăng tăng ca"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="att-note" className="text-xs font-semibold text-slate-700">
                Ghi chú
              </label>
              <input
                id="att-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={!isManager || locked}
                placeholder="Đi muộn 15p…"
                className="mt-1 w-full h-8 border border-slate-300 rounded-md px-2.5 text-xs"
              />
            </div>
            {isManager && !locked && (
              <>
                <button
                  onClick={async () => {
                    if (!selRec) {
                      await onMark({ employee_id: sel.empId, work_date: sel.iso, status: 'present', ot_hours: ot, note });
                    } else {
                      await onMark({ employee_id: sel.empId, work_date: sel.iso, status: selRec.status, ot_hours: ot, note });
                    }
                  }}
                  className={BTN_OK}
                >
                  <Check className="w-4 h-4" /> Lưu
                </button>
                {selRec && (
                  <button
                    onClick={async () => {
                      if (await confirmDialog(`Xóa công ${selEmp.full_name} ngày ${sel.iso}?`, { title: 'Xóa chấm công', confirmLabel: 'Xóa' })) {
                        await onClear(selRec.id);
                        setSel(null);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold bg-white border border-rose-300 text-rose-600 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" /> Xóa
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Panel tạm ứng lương (model riêng, có chứng từ, tự trừ vào bảng lương) ----------
function AdvancesModal({
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

// ---------- Bảng lương (chỉ đọc — nút điều khiển nằm ở tiêu đề mục 2) ----------
function PayrollTab({
  month,
  run,
  items,
  advances,
  employees,
  locked,
  isManager,
  onAddAdvance,
  onDeleteAdvance,
  advOpen,
  onCloseAdv,
}: {
  month: string;
  run?: PayrollRun;
  items: PayrollItem[];
  advances: SalaryAdvance[];
  employees: Employee[];
  locked: boolean;
  isManager: boolean;
  onAddAdvance: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; advance_date: string; note?: string }) => Promise<boolean>;
  onDeleteAdvance: (id: string) => Promise<boolean>;
  advOpen: boolean;
  onCloseAdv: () => void;
}) {
  return (
    <div className="space-y-3">
      {!run ? (
        <div>
          <EmptyState
            icon={<Banknote className="w-5 h-5" />}
            title={`Chưa có bảng lương tháng ${month}`}
            hint={isManager ? 'Bấm “Lập bảng lương” hoặc “Chốt tháng” ở trên để tổng hợp từ bảng công.' : 'Quản lý sẽ lập bảng lương tháng này.'}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[880px]">
            <thead className="bg-slate-50/80">
              <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                <th className={`${TH} w-[250px]`}>Nhân viên</th>
                <th className={`${TH} text-right`}>Lương gốc</th>
                <th className={`${TH} text-right`}>Công</th>
                <th className={`${TH} text-right`}>OT</th>
                <th className={`${TH} text-right`}>Gross</th>
                <th className={`${TH} text-right`}>Phụ cấp</th>
                <th className={`${TH} text-right`}>Tạm ứng</th>
                <th className={`${TH} text-right`}>Khấu trừ</th>
                <th className={`${TH} text-right`}>Thực nhận</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 max-w-[240px]">
                      <Avatar name={it.employee_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 leading-tight truncate" title={it.employee_name}>
                          {it.employee_name}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400">{it.salary_type === 'daily' ? 'LƯƠNG NGÀY' : 'LƯƠNG THÁNG'}</div>
                        {it.note && <div className="text-xs font-normal text-slate-500 truncate max-w-[220px]">{it.note}</div>}
                        {it.paid && <div className="text-[10px] font-bold text-emerald-600">Đã chi{it.cashbook_code ? ` · ${it.cashbook_code}` : ''}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 whitespace-nowrap">{formatVND(it.base_salary)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap">{it.days}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {it.ot_hours > 0 ? (
                      <>
                        <div className="font-bold">{it.ot_hours}h</div>
                        <div className="text-[10px] font-normal text-slate-400">
                          {formatVND(otPay(it.salary_type === 'daily' ? it.base_salary : it.base_salary / HR_POLICY.standardDaysPerMonth, it.ot_hours))}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{formatVND(it.gross)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{it.allowance ? formatVND(it.allowance) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap" title="Tự động từ các lần tạm ứng">{it.advance ? formatVND(it.advance) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 whitespace-nowrap">{it.deduction ? formatVND(it.deduction) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-extrabold text-emerald-700 whitespace-nowrap">{formatVND(it.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-extrabold">
                <td className="px-3 py-2.5">Tổng ({run.headcount} người)</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right tabular-nums">{run.total_days}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {(() => {
                    const t = items.reduce(
                      (s, x) => s + otPay(x.salary_type === 'daily' ? x.base_salary : x.base_salary / HR_POLICY.standardDaysPerMonth, x.ot_hours),
                      0,
                    );
                    return t > 0 ? `${formatVND(t)}` : '';
                  })()}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatVND(run.total_gross)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatVND(run.total_allowance)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{formatVND(run.total_advance)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{formatVND(run.total_deduction)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatVND(run.total_net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {advOpen && (
        <AdvancesModal
          month={month}
          employees={employees}
          advances={advances}
          locked={locked}
          isManager={isManager}
          onAdd={onAddAdvance}
          onDelete={onDeleteAdvance}
          onClose={onCloseAdv}
        />
      )}
    </div>
  );
}
