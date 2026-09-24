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
import { EmployeeForm } from './EmployeeForm';
// ---------- Tab 2: Nhân sự ----------
export function StaffTab({
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
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('nhan-su', [{ name: 'NhanSu', rows: list.map(staffToRow) }]);
  };

  const handlePrint = () => {
    if (list.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
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
        notify('File không có dữ liệu!', 'error');
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
      notify(`Nhập xong: ${created} tạo mới, ${updated} cập nhật (hồ sơ chưa gắn tài khoản — vào Sửa để tạo).${errors.length > 0 ? `\nLỗi:\n${errors.join('\n')}` : ''}`, 'info');
    } catch (err: any) {
      notify(`Đọc file thất bại: ${err?.message || err}`, 'error');
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
