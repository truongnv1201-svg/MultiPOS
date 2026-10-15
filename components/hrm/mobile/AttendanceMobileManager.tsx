'use client';

// Chấm công trên điện thoại — trục NGÀY (quản lý cầm máy chấm cho nhân viên mỗi ngày).
// Không port ma trận 31 cột: dải ngày cuộn ngang + danh sách bản ghi kiểu record-list
// giống giỏ hàng POS, mỗi dòng mở bottom sheet chọn trạng thái.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, Lock, Users } from 'lucide-react';
import { useStore } from '@/lib/store';
import { ATTENDANCE_STATUS_META, HR_POLICY, attendanceModeOf, monthDays, todayIso } from '@/lib/hrm';
import type { AttendanceDay, AttendanceStatus, Employee } from '@/lib/hrm';
import { Avatar, EmptyState, STATUS_CHIP } from '@/components/hrm/ui';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';
import { AttendanceDaySheet } from './AttendanceDaySheet';

const DOW_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
type Filter = 'unmarked' | 'marked' | 'all';

export function AttendanceMobileManager({
  employees,
  attendanceDays,
  payrollLocks,
  hrmLoading,
  hrmError,
  onMark,
  onClear,
}: {
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  payrollLocks: string[];
  hrmLoading: boolean;
  hrmError: string | null;
  onMark: (input: { employee_id: string; work_date: string; status: AttendanceStatus; ot_hours?: number; note?: string }) => Promise<boolean>;
  onClear: (id: string) => Promise<boolean>;
}) {
  const { setCurrentScreen } = useStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [iso, setIso] = useState(todayIso());
  const [filter, setFilter] = useState<Filter>('unmarked');
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const locked = payrollLocks.includes(monthKey);
  const days = useMemo(() => monthDays(year, month), [year, month]);

  // Dải ngày cuộn ngang: mỗi lần đổi ngày (kể cả bấm "Hôm nay" hay chuyển tháng) phải tự đưa
  // ô đang chọn vào giữa, nếu không ngày hôm nay nằm cuối dải là ngoài màn hình.
  const stripRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const strip = stripRef.current;
    const btn = dayRefs.current.get(iso);
    if (!strip || !btn) return;
    strip.scrollTo({ left: btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' });
  }, [iso, monthKey]);

  const roster = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'active')
        // 0082: diện miễn chấm công không có ô công (đồng bộ lưới desktop).
        .filter((e) => attendanceModeOf(e) === 'normal')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [employees]
  );

  const cellMap = useMemo(() => {
    const m = new Map<string, AttendanceDay>();
    for (const d of attendanceDays) if (d.work_date.startsWith(monthKey)) m.set(`${d.employee_id}:${d.work_date}`, d);
    return m;
  }, [attendanceDays, monthKey]);

  // Đếm số người đã chấm mỗi ngày để gắn badge lên dải ngày (1 lượt quét roster × ngày).
  const dayCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.iso, roster.reduce((n, e) => n + (cellMap.get(`${e.id}:${d.iso}`) ? 1 : 0), 0));
    return m;
  }, [days, roster, cellMap]);

  const rowsForDay = useMemo(() => roster.map((e) => ({ e, rec: cellMap.get(`${e.id}:${iso}`) })), [roster, cellMap, iso]);
  const markedCount = rowsForDay.filter((r) => r.rec).length;
  const visible = rowsForDay.filter((r) => (filter === 'all' ? true : filter === 'marked' ? !!r.rec : !r.rec));
  const pickedEmployee = pick ? roster.find((e) => e.id === pick) : undefined;
  const pickedRec = pick ? cellMap.get(`${pick}:${iso}`) : undefined;

  const moveMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setIso(todayIso().startsWith(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) ? todayIso() : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  };

  const fillDayPresent = async () => {
    const missing = rowsForDay.filter((r) => !r.rec);
    if (missing.length === 0) {
      notify(`Ngày ${iso} đã đủ công cho ${roster.length} người.`, 'info');
      return;
    }
    if (!(await confirmDialog(`Chấm "Đi làm" cho ${missing.length} người chưa chấm ngày ${iso}?`, { title: 'Chấm nhanh', confirmLabel: 'Chấm hết' }))) return;
    setBusy(true);
    try {
      for (const r of missing) await onMark({ employee_id: r.e.id, work_date: iso, status: 'present' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="hrm-view" className="flex-1 min-h-0 flex flex-col bg-slate-100 overflow-hidden">
      {/* Bar KHÔNG cuộn ngang: trên 390px mà để overflow thì nút "Hôm nay" bị đẩy ra ngoài màn,
          phải kéo mới bấm được. Nhãn "Bán hàng" bỏ thành icon, tiêu đề co bằng truncate,
          cả cụm tháng + Hôm nay luôn shrink-0 để không bao giờ biến mất. */}
      <div className="shrink-0 h-12 px-2 bg-white border-b border-slate-200 flex items-center gap-2">
        <button
          id="btn-att-mobile-back"
          type="button"
          onClick={() => setCurrentScreen('pos')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 active:bg-slate-100"
          aria-label="Về màn hình Bán hàng"
          title="Về màn hình Bán hàng"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold text-slate-800">
          <ClipboardCheck className="w-4 h-4 shrink-0 text-blue-600" />
          <span className="truncate">Chấm công</span>
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {locked && (
            <span className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-[10px] font-bold bg-slate-800 text-amber-300" title={`Đã chốt lương ${monthKey} — mở ở máy tính để sửa`}>
              <Lock className="w-3 h-3" /> Chốt
            </span>
          )}
          <div className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button type="button" onClick={() => moveMonth(-1)} className="h-8 w-7 flex items-center justify-center text-slate-600 active:bg-slate-100" aria-label="Tháng trước">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="inline-flex h-8 items-center border-x border-slate-200 px-1 text-xs font-bold tabular-nums text-slate-800">
              T{month}/{year}
            </span>
            <button type="button" onClick={() => moveMonth(1)} className="h-8 w-7 flex items-center justify-center text-slate-600 active:bg-slate-100" aria-label="Tháng sau">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const t = new Date();
              setYear(t.getFullYear());
              setMonth(t.getMonth() + 1);
              setIso(todayIso());
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-600 active:bg-slate-100"
            title="Về hôm nay"
          >
            <CalendarDays className="w-3.5 h-3.5" /> Hôm nay
          </button>
        </div>
      </div>

      <div
        id="att-mobile-day-strip"
        ref={stripRef}
        className="relative shrink-0 flex gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((d) => {
          const n = dayCounts.get(d.iso) || 0;
          const isSel = d.iso === iso;
          const isToday = d.iso === todayIso();
          return (
            <button
              key={d.iso}
              type="button"
              ref={(el) => {
                if (el) dayRefs.current.set(d.iso, el);
                else dayRefs.current.delete(d.iso);
              }}
              onClick={() => setIso(d.iso)}
              aria-pressed={isSel}
              className={`inline-flex h-14 w-[52px] shrink-0 flex-col items-center justify-center rounded-lg border text-center transition ${
                isSel
                  ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                  : d.dow === 0
                    ? 'border-rose-200 bg-rose-50 text-rose-600 active:bg-rose-100'
                    : 'border-slate-200 bg-white text-slate-700 active:bg-slate-100'
              }`}
            >
              <span className="text-[10px] font-bold leading-none">{DOW_LABEL[d.dow]}</span>
              <span className="mt-0.5 font-mono text-[13px] font-bold leading-none">{d.d}</span>
              <span className={`mt-0.5 font-mono text-[9px] leading-none ${isSel ? 'text-blue-100' : n === roster.length && roster.length > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {n}/{roster.length}
              </span>
              {isToday && <span className={`mt-0.5 h-1 w-1 rounded-full ${isSel ? 'bg-white' : 'bg-amber-500'}`} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {hrmError && (
          <div className="mb-2 flex items-start gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
            <span>{hrmError}</span>
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <span className="font-mono font-bold text-slate-800">{iso.slice(8, 10)}/{iso.slice(5, 7)}/{iso.slice(0, 4)}</span>
          <span className={DOW_LABEL[new Date(`${iso}T00:00:00`).getDay()] === 'CN' ? 'font-semibold text-rose-600' : 'text-slate-500'}>
            {DOW_LABEL[new Date(`${iso}T00:00:00`).getDay()]}
            {!HR_POLICY.workDays.includes(new Date(`${iso}T00:00:00`).getDay()) && ' · ngoài lịch làm'}
          </span>
          <span className="ml-auto font-bold text-slate-700 tabular-nums">
            Đã chấm {markedCount}/{roster.length}
          </span>
        </div>

        <div className="mb-2 flex gap-1.5" role="tablist" aria-label="Lọc danh sách ngày chấm công">
          {([
            { id: 'unmarked', label: `Chưa chấm (${roster.length - markedCount})` },
            { id: 'marked', label: `Đã chấm (${markedCount})` },
            { id: 'all', label: `Tất cả (${roster.length})` },
          ] as { id: Filter; label: string }[]).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={`flex-1 h-9 rounded-lg border text-[11px] font-bold transition ${
                filter === t.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 active:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!locked && roster.length > 0 && markedCount < roster.length && (
          <button
            id="btn-att-fill-day"
            type="button"
            onClick={fillDayPresent}
            disabled={busy}
            className="mb-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white active:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> {busy ? 'Đang chấm…' : `Chấm "Đi làm" cho ${roster.length - markedCount} người chưa chấm`}
          </button>
        )}

        <div id="att-mobile-record-list" className="min-h-full bg-white divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {visible.map(({ e, rec }) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setPick(e.id)}
              className="flex w-full items-center gap-2.5 px-3 py-3 text-left bg-white active:bg-slate-50"
              aria-label={`Chấm ${e.full_name} ngày ${iso}`}
            >
              <Avatar name={e.full_name} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px] font-semibold text-slate-800 leading-snug">{e.full_name}</span>
                <span className="block truncate font-mono text-[10px] text-slate-400">
                  {e.code}
                  {e.position ? ` · ${e.position}` : ''}
                </span>
              </span>
              {rec ? (
                <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-bold ${STATUS_CHIP[rec.status]}`}>
                  {ATTENDANCE_STATUS_META[rec.status].short}
                  {ATTENDANCE_STATUS_META[rec.status].label}
                  {rec.ot_hours > 0 && ` +${rec.ot_hours}h`}
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">Chưa chấm</span>
              )}
            </button>
          ))}
          {visible.length === 0 && !hrmLoading && (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title={roster.length === 0 ? 'Chưa có nhân viên cần chấm công' : filter === 'marked' ? 'Ngày này chưa có ai được chấm' : 'Đã chấm đủ ngày này'}
              hint={roster.length === 0 ? 'Thêm hồ sơ ở tab Nhân sự trên máy tính.' : 'Đổi tab "Tất cả" để sửa lại từng người.'}
            />
          )}
        </div>
      </div>

      {pick && pickedEmployee && (
        <AttendanceDaySheet
          key={`${pick}:${iso}`}
          employee={pickedEmployee}
          iso={iso}
          rec={pickedRec}
          locked={locked}
          onClose={() => setPick(null)}
          onMark={onMark}
          onClear={onClear}
        />
      )}
    </div>
  );
}
