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
// ---------- Tab 1: Tổng quan ----------
export function OverviewTab() {
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
