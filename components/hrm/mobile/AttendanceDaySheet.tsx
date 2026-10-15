'use client';

// Chấm 1 ngày của 1 nhân viên trên điện thoại: bottom sheet, 5 trạng thái >=44px,
// 1 đường ghi duy nhất qua onMark (markDay đã có khoá chống double-submit + guard tháng chốt).
import React, { useState } from 'react';
import { Check, Clock, Trash2 } from 'lucide-react';
import { ATTENDANCE_STATUS_META, ATTENDANCE_STATUS_ORDER } from '@/lib/hrm';
import type { AttendanceDay, AttendanceStatus, Employee } from '@/lib/hrm';
import { SheetShell } from '@/components/common/SheetShell';
import { BTN_GHOST, BTN_OK, STATUS_STYLE } from '@/components/hrm/ui';
import { confirmDialog } from '@/components/common/ConfirmDialog';

const DOW_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function AttendanceDaySheet({
  employee,
  iso,
  rec,
  locked,
  onClose,
  onMark,
  onClear,
}: {
  employee: Employee;
  iso: string;
  rec?: AttendanceDay;
  locked: boolean;
  onClose: () => void;
  onMark: (input: { employee_id: string; work_date: string; status: AttendanceStatus; ot_hours?: number; note?: string }) => Promise<boolean>;
  onClear: (id: string) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<AttendanceStatus>(rec?.status ?? 'present');
  const [ot, setOt] = useState<number>(rec?.ot_hours || 0);
  const [note, setNote] = useState<string>(rec?.note || '');
  const [busy, setBusy] = useState(false);

  const dow = DOW_LABEL[new Date(`${iso}T00:00:00`).getDay()];

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onMark({ employee_id: employee.id, work_date: iso, status, ot_hours: ot, note: note.trim() || undefined })) onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!rec || busy) return;
    if (!(await confirmDialog(`Xóa công ${employee.full_name} ngày ${iso}?`, { title: 'Xóa chấm công', confirmLabel: 'Xóa' }))) return;
    setBusy(true);
    try {
      if (await onClear(rec.id)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetShell open onClose={onClose} label={`Chấm công ${employee.full_name} ngày ${iso}`} icon={<Clock className="w-4 h-4 text-amber-400" />} title={`${employee.full_name} · ${dow} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {/* 3 cột (~110px/ô) thay vì 5: nhãn "Nghỉ không lương" dài, 5 cột trên màn 390px vỡ chữ */}
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Trạng thái ngày công">
          {ATTENDANCE_STATUS_ORDER.map((st) => (
            <button
              key={st}
              type="button"
              disabled={busy}
              onClick={() => setStatus(st)}
              aria-pressed={status === st}
              className={`flex h-14 flex-col items-center justify-center rounded-lg border text-center transition ${
                status === st ? STATUS_STYLE[st] + ' border-transparent shadow-sm' : 'bg-white border-slate-200 text-slate-600 active:bg-slate-100'
              }`}
            >
              <span className="text-base font-extrabold leading-none">{ATTENDANCE_STATUS_META[st].short}</span>
              <span className="mt-1 text-[10px] font-bold leading-tight opacity-90">{ATTENDANCE_STATUS_META[st].label}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase text-slate-400">TC</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOt((v) => Math.max(0, Math.round((v - 0.5) * 10) / 10))}
            className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 bg-white font-extrabold text-slate-700 active:bg-slate-100"
            aria-label="Giảm giờ tăng ca"
          >
            −
          </button>
          <input
            type="number"
            min={0}
            step={0.5}
            value={ot}
            disabled={busy}
            onChange={(e) => setOt(Math.max(0, Number(e.target.value) || 0))}
            aria-label="Số giờ tăng ca"
            className="h-9 w-16 shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-center text-sm tabular-nums"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => setOt((v) => Math.round((v + 0.5) * 10) / 10)}
            className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 bg-white font-extrabold text-slate-700 active:bg-slate-100"
            aria-label="Tăng giờ tăng ca"
          >
            +
          </button>
          <span className="text-[11px] text-slate-500">giờ</span>
        </div>

        <label htmlFor="att-sheet-note" className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
          Ghi chú
        </label>
        <input
          id="att-sheet-note"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Đi muộn 15p, làm ngoài giờ…"
          className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
        />
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3 flex gap-2">
        {rec && (
          <button type="button" onClick={remove} disabled={busy} className={BTN_GHOST}>
            <Trash2 className="w-4 h-4 text-rose-600" /> Xóa công
          </button>
        )}
        <button id="btn-att-mark-submit" type="button" onClick={save} disabled={busy || locked} className={`${BTN_OK} flex-1 h-11`}>
          <Check className="w-4 h-4" /> {busy ? 'Đang lưu…' : locked ? 'Tháng đã chốt' : 'Lưu công'}
        </button>
      </div>
    </SheetShell>
  );
}
