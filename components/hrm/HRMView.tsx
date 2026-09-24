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
import { OverviewTab } from './tabs/OverviewTab';
import { StaffTab } from './tabs/StaffTab';
import { AttendancePayrollTab } from './tabs/AttendancePayrollTab';

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
    <div id="hrm-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
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

      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
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
