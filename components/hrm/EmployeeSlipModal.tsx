'use client';

// Phiếu công & lương cá nhân (A4 dọc) — quản lý chọn 1 NV rồi in.
// Modal portal ra body để không bị overflow-hidden/transform của màn HRM cắt khi in.
// Mapping dữ liệu nằm ở lib/hrm-slip.ts (thuần, có unit test).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { formatVND } from '@/lib/format';
import { printElementInTab } from '@/lib/print';
import { notify } from '@/components/common/Toast';
import { FilterSelect } from '@/components/ui/FilterControls';
import { Printer, Share2, X, TriangleAlert, CalendarDays, UserCheck } from 'lucide-react';
import { ATTENDANCE_STATUS_META, attendanceModeOf, includeInPayroll, todayIso } from '@/lib/hrm';
import type { AttendanceDay, Employee, PayrollItem, PayrollRun, SalaryAdvance } from '@/lib/hrm';
import { buildEmployeeSlip } from '@/lib/hrm-slip';
import type { EmployeeSlip, SlipDay } from '@/lib/hrm-slip';
import { STATUS_CHIP, EmptyState } from '@/components/hrm/ui';

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MAX_WARNING_ROWS = 4;

// @page chỉ khai báo trong modal (không đưa vào globals) để không ảnh hưởng in hóa đơn POS.
const PAGE_CSS =
  '@page { size: A4 portrait; margin: 10mm; } @media print { #slip-print-area { width: 100% !important } .slip-no-break { break-inside: avoid !important; page-break-inside: avoid !important } }';

const dmy = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const stampNow = () => new Date().toLocaleString('vi-VN', { hour12: false });

function salaryTypeLabel(slip: EmployeeSlip): string {
  if (slip.source === 'none') return 'Không lương (miễn chấm công)';
  if (slip.payroll.salaryType === 'daily') return 'Lương ngày';
  if (slip.payroll.note?.includes('cố định')) return 'Lương tháng cố định';
  return 'Lương tháng';
}

function statusBadgeClass(slip: EmployeeSlip): string {
  if (slip.source === 'final') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (slip.source === 'none') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

function Field({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1 min-w-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`ml-auto truncate tabular-nums ${strong ? 'font-extrabold text-slate-900' : 'font-semibold text-slate-800'}`}>{value}</span>
    </div>
  );
}

function DayCell({ cell, today }: { cell: SlipDay | null; today: string }) {
  if (!cell) return <span className="h-[26px]" />;
  const rec = cell.record;
  const future = cell.iso > today;
  const cls = rec
    ? STATUS_CHIP[rec.status]
    : future
      ? 'border-slate-100 bg-white text-slate-300'
      : cell.dow === 0
        ? 'border-rose-100 bg-rose-50/50 text-rose-400'
        : 'border-slate-200 bg-slate-50 text-slate-400';
  return (
    <span
      title={rec ? `${dmy(cell.iso)}: ${ATTENDANCE_STATUS_META[rec.status].label}` : `${dmy(cell.iso)}: chưa chấm`}
      className={`flex h-[26px] flex-col items-center justify-center rounded border text-[9px] leading-none ${cls}`}
    >
      <span className="font-bold tabular-nums">{cell.d}</span>
      {rec && (
        <span className="mt-[1px] text-[8px]">
          {ATTENDANCE_STATUS_META[rec.status].short}
          {rec.ot_hours > 0 ? `+${rec.ot_hours}h` : ''}
        </span>
      )}
    </span>
  );
}

export function EmployeeSlipModal({
  month,
  employees,
  attendanceDays,
  run,
  items,
  advances,
  stale,
  attendanceWindowStart,
  onClose,
}: {
  month: string;
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  run?: PayrollRun;
  items: PayrollItem[];
  advances: SalaryAdvance[];
  stale: boolean;
  attendanceWindowStart?: string;
  onClose: () => void;
}) {
  const { shop, profile, isOnline } = useStore();
  const [empId, setEmpId] = useState<string | null>(null);
  const printingRef = useRef(false);
  const printTimeRef = useRef<HTMLSpanElement>(null);
  const prevTitleRef = useRef<string>('');
  const [firstStamp] = useState(stampNow);

  // Danh sách chọn: NV active hoặc có dữ liệu trong tháng (không bỏ sót người đã nghỉ giữa tháng).
  const pickable = useMemo(() => {
    const hasAtt = new Set(attendanceDays.filter((d) => d.work_date.startsWith(month)).map((d) => d.employee_id));
    const hasItem = new Set(items.map((i) => i.employee_id).filter(Boolean) as string[]);
    return employees
      .filter((e) => e.status === 'active' || hasAtt.has(e.id) || hasItem.has(e.id))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [employees, attendanceDays, items, month]);

  // Mặc định chọn NV có lương (tránh chủ/quản trị 'none' ra phiếu 0đ).
  const defaultId = useMemo(() => {
    const hasAtt = new Set(attendanceDays.filter((d) => d.work_date.startsWith(month)).map((d) => d.employee_id));
    const hasItem = new Set(items.map((i) => i.employee_id).filter(Boolean) as string[]);
    const payable = pickable.filter((e) => includeInPayroll(e));
    const withData = payable.filter((e) => hasAtt.has(e.id) || hasItem.has(e.id));
    return (withData[0] ?? payable[0] ?? pickable[0])?.id ?? '';
  }, [pickable, attendanceDays, items, month]);

  const activeId = empId && pickable.some((e) => e.id === empId) ? empId : defaultId;
  const selected = pickable.find((e) => e.id === activeId);
  const monthLabel = `${month.slice(5)}/${month.slice(0, 4)}`;

  const slip = useMemo(
    () =>
      selected
        ? buildEmployeeSlip({
            employee: selected,
            month,
            attendanceDays,
            run,
            items,
            advances,
            stale,
            offline: !isOnline,
            attendanceWindowStart,
          })
        : null,
    [selected, month, attendanceDays, run, items, advances, stale, isOnline, attendanceWindowStart]
  );

  const syncPrintTime = () => {
    if (printTimeRef.current) printTimeRef.current.textContent = stampNow();
  };

  // Escape đóng modal, nhưng khi dropdown nhân viên đang mở thì chỉ đóng dropdown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="listbox"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Đóng giữa lúc in → khôi phục tiêu đề tab ngay.
  useEffect(() => {
    return () => {
      if (document.title === '' && prevTitleRef.current) document.title = prevTitleRef.current;
    };
  }, []);

  const handlePrintDesktop = () => {
    if (printingRef.current) return;
    printingRef.current = true;
    syncPrintTime();
    const prevTitle = document.title;
    document.title = '';
    let restored = false;
    let timer = 0;
    const cleanup = () => {
      if (restored) return;
      restored = true;
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', cleanup);
      if (document.title === '') document.title = prevTitle;
    };
    timer = window.setTimeout(cleanup, 60_000);
    window.addEventListener('afterprint', cleanup);
    prevTitleRef.current = prevTitle;
    window.print();
    window.setTimeout(() => {
      printingRef.current = false;
    }, 800);
  };

  const handlePrintTablet = () => {
    if (printingRef.current) return;
    const area = document.getElementById('slip-print-area');
    if (!area) {
      notify('Chưa có nội dung phiếu để in.', 'error');
      return;
    }
    printingRef.current = true;
    syncPrintTime();
    const ok = printElementInTab(
      area,
      `Phieu cong luong ${selected?.code ?? ''} T${monthLabel}`,
      PAGE_CSS,
    );
    if (!ok) notify('Trình duyệt chặn mở tab in — cho phép popup rồi bấm lại.', 'error');
    window.setTimeout(() => {
      printingRef.current = false;
    }, 800);
  };

  const advanceRows = slip ? slip.advances.lines : [];
  const warningsShown = slip ? slip.warnings.slice(0, MAX_WARNING_ROWS) : [];
  const warningMore = slip ? slip.warnings.length - warningsShown.length : 0;
  const today = todayIso();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      id="slip-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Phiếu công lương tháng ${monthLabel}`}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{PAGE_CSS}</style>
      <div
        id="slip-modal-container"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
      >
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2 shrink-0">
          <Printer className="w-4 h-4 text-emerald-400" />
          <h3 className="font-bold text-xs">PHIẾU CÔNG &amp; LƯƠNG CÁ NHÂN · T{monthLabel}</h3>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white rounded" aria-label="Đóng phiếu">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5" /> Nhân viên:
          </span>
          {pickable.length > 0 ? (
            <FilterSelect
              id="slip-employee-select"
              value={activeId}
              onChange={setEmpId}
              title="Chọn nhân viên để in phiếu"
              options={pickable.map((e) => ({ value: e.id, label: `${e.code} — ${e.full_name}` }))}
              className="min-w-[200px] max-w-[280px]"
            />
          ) : (
            <span className="text-[11px] font-semibold text-rose-600">Không có nhân viên để in</span>
          )}
          <span className="ml-auto text-[11px] text-slate-500">Phiếu A4 dọc · 1 nhân viên</span>
        </div>

        <div className="print-preview-wrap flex-1 overflow-y-auto p-4 bg-slate-100 flex justify-center">
          {!slip ? (
            <div className="w-full max-w-[720px] bg-white border border-slate-200 rounded-xl">
              <EmptyState
                icon={<UserCheck className="w-5 h-5" />}
                title="Chưa có nhân viên để in phiếu"
                hint="Thêm nhân viên trong tab Nhân sự, sau đó quay lại in phiếu."
              />
            </div>
          ) : (
            <div
              id="slip-print-area"
              data-slip="employee"
              className="w-full max-w-[720px] bg-white border border-slate-200 shadow-sm p-4 text-slate-800"
            >
              {/* 1. Header */}
              <div className="slip-no-break text-center border-b border-slate-300 pb-2">
                <div className="text-[13px] font-extrabold uppercase leading-tight">{shop.name}</div>
                <div className="text-[9px] text-slate-600 leading-tight">
                  {shop.address}
                  {shop.hotline ? ` • ĐT: ${shop.hotline}` : ''}
                  {shop.taxCode ? ` • MST: ${shop.taxCode}` : ''}
                </div>
                <div className="mt-1.5 text-sm font-extrabold uppercase tracking-wide">PHIẾU CÔNG &amp; LƯƠNG CÁ NHÂN</div>
                <div className="text-[9px] text-slate-600">
                  Tháng {monthLabel} · Mã phiếu PL-{month.replace('-', '')}-{slip.employeeCode}
                </div>
                <div className="mt-1">
                  <span className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[9px] font-bold ${statusBadgeClass(slip)}`}>
                    {slip.statusLabel}
                  </span>
                </div>
              </div>

              {/* 2. Thông tin NV */}
              <div className="slip-no-break grid grid-cols-2 gap-x-4 gap-y-[2px] text-[10px] mt-2">
                <Field label="Mã NV:" value={slip.employeeCode} strong />
                <Field label="Họ tên:" value={slip.employeeName} strong />
                <Field label="Chức vụ:" value={selected?.position || '—'} />
                <Field label="Hình thức:" value={salaryTypeLabel(slip)} />
                <Field label="Ngày vào:" value={dmy(selected?.start_date)} />
                <Field label="Ngày lập:" value={firstStamp} />
              </div>

              {/* 3. Lương */}
              <div className="slip-no-break mt-2 rounded border border-slate-200">
                <div className="grid grid-cols-2 gap-x-4 gap-y-[2px] px-2 py-1.5 text-[10px] bg-slate-50/60">
                  <Field label="Lương gốc:" value={formatVND(slip.payroll.baseSalary)} />
                  <Field label="Công chấm:" value={`${slip.payroll.days} công`} />
                  {slip.payroll.payrollDays !== slip.payroll.days && (
                    <Field label="Công tính lương:" value={`${slip.payroll.payrollDays} (trần 26)`} />
                  )}
                  <Field
                    label="OT:"
                    value={
                      slip.payroll.otHours > 0
                        ? `${slip.payroll.otHours}h · trong đó ≈ ${formatVND(slip.payroll.otAmount)}`
                        : '—'
                    }
                  />
                  <Field label="Gross:" value={formatVND(slip.payroll.gross)} />
                  <Field label="Phụ cấp:" value={formatVND(slip.payroll.allowance)} />
                  <Field label="Khấu trừ:" value={formatVND(slip.payroll.deduction)} />
                  <Field label="Tạm ứng:" value={formatVND(slip.payroll.advance)} />
                </div>
                <div className="flex items-baseline justify-between gap-2 px-2 py-1.5 border-t border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-600">Thực nhận</span>
                  <span className={`text-base font-extrabold tabular-nums ${slip.payroll.net < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {formatVND(slip.payroll.net)}
                  </span>
                </div>
                <div className="px-2 py-1 text-[9px] text-slate-600 border-t border-dashed border-slate-200 flex flex-wrap gap-x-4 gap-y-[1px]">
                  <span>
                    Chi trả:{' '}
                    <b>
                      {slip.payroll.paid
                        ? `Đã chi${slip.payroll.cashbookCode ? ` · ${slip.payroll.cashbookCode}` : ''}`
                        : slip.runStatus === 'paid' && slip.payroll.net <= 0
                          ? 'Không chi (≤ 0đ)'
                          : slip.runStatus === 'paid'
                            ? 'Chưa đánh dấu đã chi'
                            : 'Chưa chi'}
                    </b>
                  </span>
                  {slip.payroll.note && <span className="truncate">Ghi chú: {slip.payroll.note}</span>}
                </div>
              </div>

              {/* 4. Lịch công */}
              <div className="slip-no-break mt-2">
                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-700">
                  <CalendarDays className="w-3 h-3" /> Lịch công tháng {monthLabel}
                  <span className="ml-auto font-normal text-slate-500">
                    {slip.payroll.days} công · {slip.totals.otHours}h OT · {slip.totals.absentDays} ngày vắng
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-7 gap-[2px]">
                  {DOW.map((d) => (
                    <span key={d} className="text-center text-[8px] font-bold uppercase text-slate-400">
                      {d}
                    </span>
                  ))}
                  {slip.calendar.weeks.flat().map((cell, i) => (
                    <DayCell key={cell?.iso ?? `pad${i}`} cell={cell} today={today} />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-[2px] text-[8px] text-slate-500">
                  <span><b>P</b> đi làm</span>
                  <span><b>½</b> nửa công</span>
                  <span><b>PL</b> nghỉ phép</span>
                  <span><b>KL</b> nghỉ không lương</span>
                  <span><b>L</b> lễ/Tết</span>
                  <span className="text-slate-400">Ô trống = chưa chấm</span>
                </div>
                <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[9px]">
                  <span className={`rounded border px-1 py-[1px] ${STATUS_CHIP.present}`}>Đi làm {slip.totals.present}</span>
                  <span className={`rounded border px-1 py-[1px] ${STATUS_CHIP.half}`}>Nửa công {slip.totals.half}</span>
                  <span className={`rounded border px-1 py-[1px] ${STATUS_CHIP.leave_paid}`}>Phép {slip.totals.paidLeave}</span>
                  <span className={`rounded border px-1 py-[1px] ${STATUS_CHIP.leave_unpaid}`}>Không lương {slip.totals.unpaidLeave}</span>
                </div>
                {selected && attendanceModeOf(selected) !== 'normal' && (
                  <p className="mt-1 text-[9px] font-semibold text-violet-700">
                    Nhân viên thuộc diện miễn chấm công — lịch chỉ để tham khảo.
                  </p>
                )}
              </div>

              {/* 5. Tạm ứng */}
              {advanceRows.length > 0 && (
                <div className="slip-no-break mt-2">
                  <div className="text-[10px] font-bold text-slate-700">Tạm ứng trong tháng</div>
                  <table className="mt-1 w-full text-[9px] border border-slate-200">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-1.5 py-[2px] text-left font-semibold">Ngày</th>
                        <th className="px-1.5 py-[2px] text-left font-semibold">Quỹ</th>
                        <th className="px-1.5 py-[2px] text-right font-semibold">Số tiền</th>
                        <th className="px-1.5 py-[2px] text-left font-semibold">Phiếu chi</th>
                        <th className="px-1.5 py-[2px] text-left font-semibold">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {advanceRows.map((a, i) => (
                        <tr key={`${a.date}-${i}`}>
                          <td className="px-1.5 py-[2px] tabular-nums">{dmy(a.date)}</td>
                          <td className="px-1.5 py-[2px]">{a.fund === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}</td>
                          <td className="px-1.5 py-[2px] text-right tabular-nums font-semibold">{formatVND(a.amount)}</td>
                          <td className="px-1.5 py-[2px] font-mono">{a.cashbookCode || '—'}</td>
                          <td className="px-1.5 py-[2px] truncate max-w-[140px]">{a.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                        <td className="px-1.5 py-[2px]" colSpan={2}>
                          Tổng {slip.advances.lines.length + slip.advances.hiddenCount} lần
                        </td>
                        <td className="px-1.5 py-[2px] text-right tabular-nums">{formatVND(slip.advances.total)}</td>
                        <td className="px-1.5 py-[2px]" colSpan={2}>
                          {slip.advances.hiddenCount > 0 ? `và ${slip.advances.hiddenCount} lần khác` : ''}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  {slip.advances.mismatch && (
                    <p className="mt-1 text-[9px] text-amber-700">
                      Số khấu trừ trên phiếu là {formatVND(slip.payroll.advance)} (đã chốt); tổng tạm ứng hiện tại {formatVND(slip.advances.total)}.
                    </p>
                  )}
                </div>
              )}

              {/* 6. Cảnh báo */}
              {warningsShown.length > 0 && (
                <div className="slip-no-break mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] text-amber-800">
                  <div className="flex items-center gap-1 font-bold">
                    <TriangleAlert className="w-3 h-3" /> Lưu ý
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-[1px]">
                    {warningsShown.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  {warningMore > 0 && <p className="mt-0.5">… và {warningMore} cảnh báo khác.</p>}
                </div>
              )}

              {/* 7. Chữ ký */}
              <div className="slip-no-break mt-3 grid grid-cols-2 gap-4 text-center text-[9px]">
                <div>
                  <p className="font-bold">Người lập phiếu</p>
                  <p className="text-slate-400">(Ký, ghi rõ họ tên)</p>
                  <p className="mt-8 font-semibold text-slate-700">{profile?.full_name || ''}</p>
                </div>
                <div>
                  <p className="font-bold">Nhân viên nhận phiếu</p>
                  <p className="text-slate-400">(Ký, ghi rõ họ tên)</p>
                  <p className="mt-8 font-semibold text-slate-700">{slip.employeeName}</p>
                </div>
              </div>

              {/* 8. Footer */}
              <div className="mt-2 pt-1 border-t border-dashed border-slate-300 flex items-center justify-between text-[8px] text-slate-500">
                <span>
                  In lúc: <span id="slip-print-time" ref={printTimeRef}>{firstStamp}</span>
                </span>
                <span>MultiPOS · Phiếu cá nhân</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
            Đóng
          </button>
          <div className="flex items-center gap-2">
            <button
              id="btn-print-slip-mobile"
              type="button"
              disabled={!slip}
              onClick={handlePrintTablet}
              className="hidden md:flex lg:hidden px-4 h-10 border border-blue-200 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg items-center gap-1.5 disabled:opacity-50"
            >
              <Share2 className="w-4 h-4" />
              <span>In / Lưu PDF</span>
            </button>
            <button
              id="btn-print-slip"
              type="button"
              disabled={!slip}
              onClick={handlePrintDesktop}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm hidden lg:flex items-center gap-1.5 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              <span>In A4 dọc</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
