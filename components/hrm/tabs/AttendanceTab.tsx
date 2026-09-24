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
// ---------- Tab 3: Chấm công ----------
const CYCLE: (AttendanceStatus | null)[] = ['present', 'half', 'leave_paid', 'leave_unpaid', 'holiday', null];
const KEY_TO_STATUS: Record<string, AttendanceStatus> = { '1': 'present', '2': 'half', '3': 'leave_paid', '4': 'leave_unpaid', '5': 'holiday' };

export function AttendanceTab({
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
      notify(`${selEmp.full_name} đã đủ công các ngày làm việc trong tháng.`, 'info');
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
      notify('Không có dữ liệu để xuất!', 'error');
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
      notify('Không có dữ liệu để in!', 'error');
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
