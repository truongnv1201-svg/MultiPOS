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
// Modal thêm/sửa hồ sơ: gom nhóm theo section, lỗi hiện ngay dưới ô
export function EmployeeForm({
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
