'use client';

// "Công của tôi" cho điện thoại — nhân viên KHÔNG có quyền chấm chỉ XEM: bảng tóm tắt tháng,
// lịch 7 cột và vài ngày gần nhất. Không có bất kỳ đường ghi nào (markDay/clearDay).
import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, UserCheck, BadgeCheck } from 'lucide-react';
import { useStore } from '@/lib/store';
import { ATTENDANCE_STATUS_META, attendanceModeOf, monthDays, todayIso } from '@/lib/hrm';
import type { AttendanceDay, Employee } from '@/lib/hrm';
import { EmptyState, STATUS_CHIP } from '@/components/hrm/ui';

const DOW_HEADER = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export function MyAttendanceView({
  employees,
  attendanceDays,
  hrmLoading,
  hrmError,
}: {
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  hrmLoading: boolean;
  hrmError: string | null;
}) {
  const { setCurrentScreen, user } = useStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const me = useMemo(() => employees.find((e) => e.user_id && e.user_id === user?.id), [employees, user?.id]);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const days = useMemo(() => monthDays(year, month), [year, month]);

  const rows = useMemo(
    () => (me ? attendanceDays.filter((d) => d.employee_id === me.id && d.work_date.startsWith(monthKey)) : []),
    [attendanceDays, me, monthKey]
  );
  const byDate = useMemo(() => new Map(rows.map((r) => [r.work_date, r])), [rows]);

  const totals = useMemo(() => {
    let d = 0;
    let ot = 0;
    for (const r of rows) {
      d += ATTENDANCE_STATUS_META[r.status]?.days ?? 0;
      ot += Number(r.ot_hours) || 0;
    }
    return { days: Math.round(d * 100) / 100, ot: Math.round(ot * 100) / 100 };
  }, [rows]);

  const missing = useMemo(() => days.filter((x) => !byDate.get(x.iso)).length, [days, byDate]);
  const recent = useMemo(() => [...rows].sort((a, b) => b.work_date.localeCompare(a.work_date)).slice(0, 7), [rows]);

  const moveMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const exempt = me ? attendanceModeOf(me) !== 'normal' : false;

  return (
    <div id="my-attendance-view" className="flex-1 min-h-0 flex flex-col bg-slate-100 overflow-hidden">
      <div className="shrink-0 h-12 px-2 bg-white border-b border-slate-200 flex items-center gap-2">
        <button
          id="btn-att-mobile-back"
          type="button"
          onClick={() => setCurrentScreen('pos')}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-600 active:bg-slate-100"
          aria-label="Về màn hình Bán hàng"
        >
          <ArrowLeft className="w-4 h-4" /> Bán hàng
        </button>
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800 whitespace-nowrap">
          <UserCheck className="w-4 h-4 text-blue-600" /> Công của tôi
        </h2>
        {me && (
          <div className="ml-auto inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button type="button" onClick={() => moveMonth(-1)} className="h-8 w-8 flex items-center justify-center text-slate-600 active:bg-slate-100" aria-label="Tháng trước">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="inline-flex h-8 items-center border-x border-slate-200 px-1.5 text-xs font-bold tabular-nums text-slate-800">
              T{month}/{year}
            </span>
            <button type="button" onClick={() => moveMonth(1)} className="h-8 w-8 flex items-center justify-center text-slate-600 active:bg-slate-100" aria-label="Tháng sau">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {hrmError && (
          <div className="mb-2 flex items-start gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
            <span>{hrmError}</span>
          </div>
        )}

        {!me ? (
          <div className="min-h-full bg-white border border-slate-200 rounded-xl">
            <EmptyState
              icon={<BadgeCheck className="w-5 h-5" />}
              title="Chưa tìm thấy hồ sơ của bạn"
              hint="Tài khoản này chưa được gắn vào hồ sơ nhân viên. Nhờ Quản lý mở tab Nhân sự (trên máy tính) và gắn tài khoản."
            />
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2.5">
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{me.full_name}</span>
                  <span className="block truncate font-mono text-[10px] text-slate-400">
                    {me.code}
                    {me.position ? ` · ${me.position}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-slate-500">Tháng {monthKey}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 border border-slate-200 py-2">
                  <div className="font-mono text-lg font-extrabold text-slate-900 leading-none">{totals.days}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Công</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 py-2">
                  <div className="font-mono text-lg font-extrabold text-slate-900 leading-none">{totals.ot}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Giờ TC</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 py-2">
                  <div className={`font-mono text-lg font-extrabold leading-none ${missing > 0 && !exempt ? 'text-rose-600' : 'text-slate-900'}`}>{missing}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Ngày trống</div>
                </div>
              </div>
              {exempt ? (
                <p className="mt-2 text-[11px] font-semibold text-violet-700">
                  Bạn thuộc diện miễn chấm công — số liệu chỉ mang tính tham khảo.
                </p>
              ) : (
                missing > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    {missing} ngày làm việc chưa được chấm — nhờ Quản lý bổ sung trên điện thoại.
                  </p>
                )
              )}
            </div>

            <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-slate-400">
                {DOW_HEADER.map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: (new Date(year, month - 1, 1).getDay() + 6) % 7 }).map((_, i) => (
                  <span key={`pad${i}`} />
                ))}
                {days.map((d) => {
                  const rec = byDate.get(d.iso);
                  return (
                    <span
                      key={d.iso}
                      title={rec ? `${d.iso}: ${ATTENDANCE_STATUS_META[rec.status].label}` : `${d.iso}: chưa chấm`}
                      className={`flex h-10 flex-col items-center justify-center rounded-md border text-[11px] font-bold tabular-nums ${
                        rec ? STATUS_CHIP[rec.status] : d.dow === 0 ? 'border-rose-100 bg-rose-50/60 text-rose-400' : 'border-slate-200 bg-slate-50 text-slate-400'
                      } ${d.iso === todayIso() ? 'ring-2 ring-blue-500' : ''}`}
                    >
                      <span className="leading-none">{d.d}</span>
                      {rec && <span className="leading-none text-[9px]">{ATTENDANCE_STATUS_META[rec.status].short}</span>}
                    </span>
                  );
                })}
              </div>
            </div>

            <div id="my-attendance-recent" className="mt-2 bg-white divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {recent.map((r) => (
                <div key={r.id} className="px-3 py-2.5 bg-white flex items-center gap-2.5">
                  <span className="shrink-0 font-mono text-[11px] font-bold text-slate-500 tabular-nums">
                    {r.work_date.slice(8, 10)}/{r.work_date.slice(5, 7)}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[11px] text-slate-600">{r.note || ATTENDANCE_STATUS_META[r.status].label}</span>
                  <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-bold ${STATUS_CHIP[r.status]}`}>
                    {ATTENDANCE_STATUS_META[r.status].short}
                    {r.ot_hours > 0 && ` +${r.ot_hours}h`}
                  </span>
                </div>
              ))}
              {recent.length === 0 && !hrmLoading && (
                <EmptyState icon={<UserCheck className="w-5 h-5" />} title="Tháng này chưa có ngày nào được chấm" hint="Quản lý sẽ chấm công hằng ngày trên điện thoại." />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
