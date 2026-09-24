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
import { AdvancesModal } from './AdvancesModal';
// ---------- Bảng lương (chỉ đọc — nút điều khiển nằm ở tiêu đề mục 2) ----------
export function PayrollTab({
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
