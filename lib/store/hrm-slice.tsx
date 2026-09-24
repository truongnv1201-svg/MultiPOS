// P3-phan 2 (cuoi): slice HRM - nhan su, cham cong ngay, tam ung, bang luong.
// Consume Auth (supa/user/profile) + Network (isOnline) + Transactions (setCashbook/cashbook/currentShift).
// Facade useStore() giu nguyen.
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './auth';
import { useNetwork } from './network';
import { useTransactions } from './transactions';
import {
  Employee,
  AttendanceDay,
  AttendanceStatus,
  PayrollRun,
  PayrollItem,
  SalaryAdvance,
  buildPayrollItem,
  nextEmployeeCode,
  employeeLoginEmail,
} from '../hrm';
import type { MarkDayInput, CashbookEntry } from '../types';
import type { EmployeeInput, HrmAccount } from './types';
import { db, generateOrderCode } from '../db';
import { createClient } from '@supabase/supabase-js';
import { vietnamizeError } from '../error-vi';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';
import { employeeCols } from './staff';

export interface HrmSlice {
  employees: Employee[];
  attendanceDays: AttendanceDay[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  setAttendanceDays: React.Dispatch<React.SetStateAction<AttendanceDay[]>>;
  setPayrollLocks: React.Dispatch<React.SetStateAction<string[]>>;
  setPayrollRuns: React.Dispatch<React.SetStateAction<PayrollRun[]>>;
  setPayrollItems: React.Dispatch<React.SetStateAction<PayrollItem[]>>;
  setAdvances: React.Dispatch<React.SetStateAction<SalaryAdvance[]>>;
  setPayrollStaleMonths: React.Dispatch<React.SetStateAction<string[]>>;
  setAccounts: React.Dispatch<React.SetStateAction<HrmAccount[]>>;
  setHrmError: React.Dispatch<React.SetStateAction<string | null>>;
  hrmLoading: boolean;
  hrmError: string | null;
  refreshHrm: () => Promise<void>;
  accounts: HrmAccount[];
  saveEmployee: (input: EmployeeInput) => Promise<boolean>;
  setEmployeeStatus: (id: string, status: 'active' | 'inactive') => Promise<boolean>;
  createEmployeeWithAccount: (emp: EmployeeInput, acct: { password: string; role: string }) => Promise<boolean>;
  createAccountForEmployee: (employeeId: string, acct: { password: string; role: string }) => Promise<boolean>;
  resetEmployeePassword: (employeeId: string, newPassword: string) => Promise<boolean>;
  markDay: (input: MarkDayInput) => Promise<boolean>;
  clearDay: (id: string) => Promise<boolean>;
  payrollLocks: string[];
  setMonthLock: (month: string, locked: boolean) => Promise<boolean>;
  payrollRuns: PayrollRun[];
  payrollItems: PayrollItem[];
  advances: SalaryAdvance[];
  addAdvance: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; advance_date: string; note?: string }) => Promise<boolean>;
  deleteAdvance: (id: string) => Promise<boolean>;
  addAdvanceVoucher: (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; note?: string }) => Promise<boolean>;
  payrollStaleMonths: string[];
  generatePayroll: (month: string) => Promise<boolean>;
  lockMonth: (month: string) => Promise<boolean>;
  reopenPayroll: (runId: string) => Promise<boolean>;
  payPayroll: (runId: string, fund: 'cash' | 'bank') => Promise<boolean>;
}

const HrmContext = createContext<HrmSlice | null>(null);

export function HrmProvider({ children }: { children: React.ReactNode }) {
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { isOnline } = useNetwork();
  const { setCashbook, cashbook, currentShift } = useTransactions();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceDays, setAttendanceDays] = useState<AttendanceDay[]>([]);
  const [payrollLocks, setPayrollLocks] = useState<string[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payrollItems, setPayrollItems] = useState<PayrollItem[]>([]);
  const [advances, setAdvances] = useState<SalaryAdvance[]>([]);
  const [payrollStaleMonths, setPayrollStaleMonths] = useState<string[]>([]);
  const [hrmLoading, setHrmLoading] = useState<boolean>(false);
  const [hrmError, setHrmError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<HrmAccount[]>([]);
  // Chữ ký dữ liệu server lần cuối — refresh trùng thì bỏ qua, tránh render + ghi Dexie thừa
  const hrmSigRef = useRef<Record<string, string>>({});

  // === HRM rebuild (gọn cho shop nhỏ) ===
  // employees là master duy nhất; công là điểm danh ngày; phép duyệt tự sinh công.
  const isUuid = (v: string | undefined) =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  // Guard quyền HRM — useCallback để identity ổn định, các callback HRM liệt kê vào deps
  // (exhaustive-deps) mà không gây vòng lặp (chỉ đổi khi supa/user/profile đổi).
  const requireHrmManager = useCallback(
    (action: string): boolean => {
      if (!supa || !user) {
        notify('Vui lòng đăng nhập!', 'error');
        setLoginOpen(true);
        return false;
      }
      if (profile?.role !== 'admin' && profile?.role !== 'manager') {
        notify(`Chỉ Admin/Quản lý được ${action}!`, 'error');
        return false;
      }
      return true;
    },
    [supa, user, profile, setLoginOpen]
  );

  // Đánh dấu bảng nháp tháng này đã lỗi thời (công/ứng đổi sau khi lập) -> UI nhắc Tạo lại
  const markPayrollStale = useCallback(
    (month: string) => {
      if (!month) return;
      if (payrollRuns.some((r) => r.month === month && r.status === 'draft')) {
        setPayrollStaleMonths((ms) => (ms.includes(month) ? ms : [...ms, month]));
      }
    },
    [payrollRuns]
  );

  // Kéo toàn bộ HRM từ server (có mạng + đã login). Local chỉ giữ cache + dòng chưa sync.
  const refreshHrm = useCallback(async (): Promise<void> => {
    if (!supa || !user || !isOnline) return;
    setHrmLoading(true);
    try {
      const [emps, days, locks, runs, advs] = await Promise.all([
        supa.from('employees').select('*').order('code'),
        supa.from('attendance_days').select('*').order('work_date', { ascending: false }).limit(2000),
        supa.from('payroll_locks').select('month'),
        supa.from('payroll_runs').select('*').order('month', { ascending: false }).limit(24),
        supa.from('salary_advances').select('*').order('advance_date', { ascending: false }).limit(500),
      ]);
      const firstErr = emps.error || days.error || locks.error || runs.error || advs.error;
      setHrmError(
        firstErr
          ? `Không tải được dữ liệu nhân sự: ${firstErr.message} (kiểm tra mạng, quyền, hoặc đã chạy các migration HRM 0019–0022 chưa)`
          : null
      );
      // Danh sách tài khoản để gắn hồ sơ: thử kèm email (migration 0020), rớt thì thử không email
      try {
        const withMail = await supa.from('profiles').select('id, full_name, role, email').order('full_name');
        if (withMail.error) throw withMail.error;
        setAccounts(
          (withMail.data as any[]).map((r) => ({
            id: r.id,
            full_name: r.full_name,
            role: r.role,
            email: r.email ?? undefined,
          }))
        );
      } catch {
        try {
          const noMail = await supa.from('profiles').select('id, full_name, role').order('full_name');
          if (noMail.error) throw noMail.error;
          setAccounts(
            (noMail.data as any[]).map((r) => ({
              id: r.id,
              full_name: r.full_name,
              role: r.role,
            }))
          );
        } catch {
          /* RLS chặn hoặc chưa login -> dropdown gắn TK trống, form vẫn tạo mới được */
        }
      }
      if (emps.data) {
        const rows: Employee[] = (emps.data as any[]).map((r) => ({
          id: r.id,
          code: r.code,
          full_name: r.full_name,
          phone: r.phone ?? undefined,
          position: r.position ?? undefined,
          salary_type: r.salary_type ?? 'daily',
          daily_wage: Number(r.daily_wage) || 0,
          monthly_salary: Number(r.monthly_salary) || 0,
          allowance_default: Number(r.allowance_default) || 0,
          start_date: r.start_date ?? undefined,
          status: r.status ?? 'active',
          user_id: r.user_id ?? undefined,
          created_at: r.created_at,
          synced: true,
        }));
        const empSig = JSON.stringify(rows);
        // Server không đổi -> giữ nguyên state, tránh render thừa
        if (empSig !== hrmSigRef.current.emp) {
          hrmSigRef.current.emp = empSig;
          setEmployees((prev) => {
            const pending = prev.filter((e) => !e.synced);
            const merged = [...rows];
            for (const p of pending) if (!merged.some((m) => m.id === p.id)) merged.push(p);
            return merged;
          });
          db.employees.clear().then(() => db.employees.bulkAdd(rows)).catch(() => {});
        }
      }
      if (days.data) {
        const rows: AttendanceDay[] = (days.data as any[]).map((r) => ({
          id: r.id,
          employee_id: r.employee_id,
          work_date: r.work_date,
          status: r.status ?? 'present',
          ot_hours: Number(r.ot_hours) || 0,
          note: r.note ?? undefined,
          created_at: r.created_at,
          synced: true,
        }));
        const daySig = JSON.stringify(rows);
        if (daySig !== hrmSigRef.current.day) {
          hrmSigRef.current.day = daySig;
          setAttendanceDays((prev) => {
            const pending = prev.filter((a) => !a.synced);
            const merged = [...rows];
            for (const p of pending) if (!merged.some((m) => m.id === p.id)) merged.push(p);
            return merged;
          });
          db.attendanceDays.clear().then(() => db.attendanceDays.bulkAdd(rows)).catch(() => {});
        }
      }
      if (locks.data) {
        const months = (locks.data as any[]).map((r) => r.month).sort().join(',');
        if (months !== hrmSigRef.current.locks) {
          hrmSigRef.current.locks = months;
          setPayrollLocks((locks.data as any[]).map((r) => r.month));
        }
      }
      if (advs.data) {
        const rows: SalaryAdvance[] = (advs.data as any[]).map((r) => ({
          id: r.id,
          employee_id: r.employee_id,
          amount: Number(r.amount) || 0,
          fund_type: r.fund_type ?? 'cash',
          advance_date: r.advance_date,
          month: r.month,
          note: r.note ?? undefined,
          cashbook_code: r.cashbook_code ?? undefined,
          created_by: r.created_by ?? undefined,
          created_at: r.created_at,
        }));
        const sig = JSON.stringify(rows);
        if (sig !== hrmSigRef.current.adv) {
          hrmSigRef.current.adv = sig;
          setAdvances(rows);
        }
      }
      if (runs.data) {
        const runIds = (runs.data as any[]).map((r) => r.id);
        let items: any[] = [];
        if (runIds.length > 0) {
          const { data } = await supa.from('payroll_items').select('*').in('run_id', runIds).order('employee_name');
          items = (data as any[]) || [];
        }
        const runRows: PayrollRun[] = (runs.data as any[]).map((r) => ({
          id: r.id,
          month: r.month,
          status: r.status,
          headcount: Number(r.headcount) || 0,
          total_days: Number(r.total_days) || 0,
          total_gross: Number(r.total_gross) || 0,
          total_allowance: Number(r.total_allowance) || 0,
          total_deduction: Number(r.total_deduction) || 0,
          total_advance: Number(r.total_advance) || 0,
          total_net: Number(r.total_net) || 0,
          created_by: r.created_by ?? undefined,
          created_at: r.created_at,
          finalized_at: r.finalized_at ?? undefined,
          paid_at: r.paid_at ?? undefined,
        }));
        const itemRows: PayrollItem[] = items.map((it) => ({
            id: it.id,
            run_id: it.run_id,
            employee_id: it.employee_id ?? undefined,
            employee_name: it.employee_name,
            salary_type: it.salary_type ?? 'daily',
            base_salary: Number(it.base_salary) || 0,
            days: Number(it.days) || 0,
            ot_hours: Number(it.ot_hours) || 0,
            gross: Number(it.gross) || 0,
            allowance: Number(it.allowance) || 0,
            deduction: Number(it.deduction) || 0,
            advance: Number(it.advance) || 0,
            note: it.note ?? undefined,
            net: Number(it.net) || 0,
            paid: !!it.paid,
            cashbook_code: it.cashbook_code ?? undefined,
          }));
          const paySig = JSON.stringify([runRows, itemRows]);
          if (paySig !== hrmSigRef.current.pay) {
            hrmSigRef.current.pay = paySig;
            setPayrollRuns(runRows);
            setPayrollItems(itemRows);
          }
      }
    } catch {
      /* offline giữa chừng -> giữ local */
    } finally {
      setHrmLoading(false);
    }
  }, [supa, user, isOnline]);

  // Thêm mới / sửa hồ sơ nhân viên (manager, cần online — id uuid do server cấp)
  const saveEmployee = useCallback(
    async (input: EmployeeInput): Promise<boolean> => {
      if (!requireHrmManager('thêm/sửa nhân viên')) return false;
      if (!input.full_name.trim()) {
        notify('Nhập tên nhân viên!', 'error');
        return false;
      }
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới thêm/sửa nhân viên được!', 'error');
        return false;
      }
      const cols = employeeCols(input);
      try {
        if (input.id) {
          // Sửa hồ sơ: chỉ đổi user_id khi form gửi lên rõ ràng (tránh gỡ nhầm link tài khoản)
          const { user_id: _ignore, ...colsNoLink } = cols;
          const payload = { ...(input.user_id !== undefined ? cols : colsNoLink), updated_at: new Date().toISOString() };
          const { error } = await supa.from('employees').update(payload).eq('id', input.id);
          if (error) throw new Error(error.message);
          setEmployees((prev) =>
            prev.map((e) =>
              e.id === input.id
                ? {
                    ...e,
                    ...cols,
                    phone: cols.phone ?? undefined,
                    position: cols.position ?? undefined,
                    start_date: cols.start_date ?? undefined,
                    user_id: input.user_id !== undefined ? input.user_id || undefined : e.user_id,
                  }
                : e
            )
          );
          const cur = employees.find((e) => e.id === input.id);
          if (cur)
            db.employees
              .put({ ...cur, ...cols, user_id: input.user_id !== undefined ? input.user_id || undefined : cur.user_id } as Employee)
              .catch(() => {});
        } else {
          const code = nextEmployeeCode(employees);
          const { data, error } = await supa
            .from('employees')
            .insert({ ...cols, code, status: 'active' })
            .select('*')
            .single();
          if (error) throw new Error(error.message);
          const r = data as any;
          const emp: Employee = {
            id: r.id,
            code: r.code,
            full_name: r.full_name,
            phone: r.phone ?? undefined,
            position: r.position ?? undefined,
            salary_type: r.salary_type ?? 'daily',
            daily_wage: Number(r.daily_wage) || 0,
            monthly_salary: Number(r.monthly_salary) || 0,
            allowance_default: Number(r.allowance_default) || 0,
            start_date: r.start_date ?? undefined,
            status: 'active',
            user_id: r.user_id ?? undefined,
            created_at: r.created_at,
            synced: true,
          };
          setEmployees((prev) => [...prev, emp].sort((a, b) => a.code.localeCompare(b.code)));
          db.employees.add(emp).catch(() => {});
        }
        return true;
      } catch (err: any) {
        notify(`Lưu nhân viên thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, user, isOnline, employees]
  );

  // Tạo tài khoản đăng nhập qua API (dùng session hiện tại, không đá login) — dùng chung các luồng gộp
  const createLoginAccount = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      role: string
    ): Promise<{ id: string; email: string; full_name: string; role: string } | null> => {
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới tạo tài khoản được!', 'error');
        return null;
      }
      try {
        const { data: sess } = await supa.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          notify('Phiên đăng nhập hết hạn — vui lòng đăng nhập lại.', 'error');
          setLoginOpen(true);
          return null;
        }
        const res = await fetch('/api/admin/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email: email.trim(), password: password.trim(), full_name: fullName.trim(), role }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          notify(json.error || 'Tạo tài khoản thất bại.', 'error');
          return null;
        }
        const rec = { id: json.id as string, email: email.trim(), full_name: fullName.trim(), role };
        setAccounts((prev) => (prev.some((a) => a.id === rec.id) ? prev : [...prev, rec]));
        return rec;
      } catch (err: any) {
        notify(vietnamizeError(err), 'error');
        return null;
      }
    },
    [supa, user, isOnline, setLoginOpen]
  );

  // Tạo nhân viên + tài khoản đăng nhập trong 1 lần.
  // Mã NV tự sinh (NV0001...), tài khoản đăng nhập chính là mã NV + mật khẩu.
  const createEmployeeWithAccount = useCallback(
    async (emp: EmployeeInput, acct: { password: string; role: string }): Promise<boolean> => {
      if (!requireHrmManager('thêm nhân viên')) return false;
      if (!emp.full_name.trim()) {
        notify('Nhập tên nhân viên!', 'error');
        return false;
      }
      if (acct.password.trim().length < 6) {
        notify('Mật khẩu phải từ 6 ký tự trở lên!', 'error');
        return false;
      }
      if (profile?.role !== 'admin' && acct.role !== 'cashier' && acct.role !== 'worker') {
        notify('Quản lý chỉ được tạo tài khoản Thu ngân / Thợ!', 'error');
        return false;
      }
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới thêm nhân viên được!', 'error');
        return false;
      }
      try {
        const code = nextEmployeeCode(employees);
        const acc = await createLoginAccount(employeeLoginEmail(code), acct.password, emp.full_name.trim(), acct.role);
        if (!acc) return false;
        const userId = acc.id;
        // 2) Tạo hồ sơ gắn thẳng tài khoản vừa tạo
        const { data, error } = await supa
          .from('employees')
          .insert({ ...employeeCols(emp), code, status: 'active', user_id: userId })
          .select('*')
          .single();
        if (error) throw new Error(`Đã tạo tài khoản ${code} nhưng tạo hồ sơ thất bại: ${error.message}.`);
        const r = data as any;
        const rec: Employee = {
          id: r.id,
          code: r.code,
          full_name: r.full_name,
          phone: r.phone ?? undefined,
          position: r.position ?? undefined,
          salary_type: r.salary_type ?? 'daily',
          daily_wage: Number(r.daily_wage) || 0,
          monthly_salary: Number(r.monthly_salary) || 0,
          allowance_default: Number(r.allowance_default) || 0,
          start_date: r.start_date ?? undefined,
          status: 'active',
          user_id: userId,
          created_at: r.created_at,
          synced: true,
        };
        setEmployees((prev) => [...prev, rec].sort((a, b) => a.code.localeCompare(b.code)));
        db.employees.add(rec).catch(() => {});
        return true;
      } catch (err: any) {
        notify(vietnamizeError(err), 'error');
        return false;
      }
    },
    [requireHrmManager, supa, user, profile, isOnline, employees, createLoginAccount]
  );

  // Tạo tài khoản đăng nhập cho NV cũ chưa có (theo đúng mã NV của họ)
  const createAccountForEmployee = useCallback(
    async (employeeId: string, acct: { password: string; role: string }): Promise<boolean> => {
      if (!requireHrmManager('tạo tài khoản')) return false;
      const emp = employees.find((e) => e.id === employeeId);
      if (!emp) return false;
      if (!isOnline || !supa) {
        notify('Cần Online mới tạo được!', 'error');
        return false;
      }
      if (acct.password.trim().length < 6) {
        notify('Mật khẩu phải từ 6 ký tự trở lên!', 'error');
        return false;
      }
      if (profile?.role !== 'admin' && acct.role !== 'cashier' && acct.role !== 'worker') {
        notify('Quản lý chỉ được tạo tài khoản Thu ngân / Thợ!', 'error');
        return false;
      }
      const acc = await createLoginAccount(employeeLoginEmail(emp.code), acct.password, emp.full_name, acct.role);
      if (!acc) return false;
      try {
        const { error } = await supa.from('employees').update({ user_id: acc.id }).eq('id', employeeId);
        if (error) throw new Error(error.message);
        setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, user_id: acc.id } : e)));
        db.employees.put({ ...emp, user_id: acc.id }).catch(() => {});
        return true;
      } catch (err: any) {
        notify(`Gắn tài khoản thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, profile, isOnline, employees, createLoginAccount]
  );

  // Đặt lại mật khẩu đăng nhập cho nhân viên (manager: chỉ Thu ngân/Thợ; admin: mọi role)
  const resetEmployeePassword = useCallback(
    async (employeeId: string, newPassword: string): Promise<boolean> => {
      if (!requireHrmManager('đặt lại mật khẩu')) return false;
      const emp = employees.find((e) => e.id === employeeId);
      if (!emp?.user_id) {
        notify('Hồ sơ này chưa có tài khoản đăng nhập!', 'error');
        return false;
      }
      if (newPassword.trim().length < 6) {
        notify('Mật khẩu phải từ 6 ký tự trở lên!', 'error');
        return false;
      }
      if (!isOnline || !supa) {
        notify('Cần Online mới đặt lại được!', 'error');
        return false;
      }
      try {
        const { data: sess } = await supa.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          notify('Phiên đăng nhập hết hạn — vui lòng đăng nhập lại.', 'error');
          setLoginOpen(true);
          return false;
        }
        const res = await fetch('/api/admin/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ user_id: emp.user_id, password: newPassword.trim() }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          notify(json.error || 'Đặt lại mật khẩu thất bại.', 'error');
          return false;
        }
        notify(`Đã đặt lại mật khẩu cho ${emp.code} — ${emp.full_name}.`, 'success');
        return true;
      } catch (err: any) {
        notify(vietnamizeError(err), 'error');
        return false;
      }
    },
    [requireHrmManager, supa, isOnline, employees, setLoginOpen]
  );

  // Ghi 1 lần tạm ứng: bản ghi salary_advances + phiếu chi category 'advance' trong sổ quỹ
  const addAdvance = useCallback(
    async (input: {
      employee_id: string;
      amount: number;
      fund_type: 'cash' | 'bank';
      advance_date: string;
      note?: string;
    }): Promise<boolean> => {
      if (!requireHrmManager('ghi tạm ứng')) return false;
      const emp = employees.find((e) => e.id === input.employee_id);
      if (!emp || emp.status !== 'active') {
        notify('Chọn nhân viên đang làm việc!', 'error');
        return false;
      }
      const amount = Math.max(0, Math.round(Number(input.amount) || 0));
      if (amount <= 0) {
        notify('Nhập số tiền tạm ứng!', 'error');
        return false;
      }
      if (!input.advance_date) {
        notify('Chọn ngày ứng!', 'error');
        return false;
      }
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới ghi tạm ứng được!', 'error');
        return false;
      }
      const month = input.advance_date.slice(0, 7);
      if (payrollLocks.includes(month)) {
        notify(`Tháng ${month} đã chốt lương — không ghi tạm ứng được!`, 'error');
        return false;
      }
      try {
        const { data, error } = await supa
          .from('salary_advances')
          .insert({
            employee_id: emp.id,
            amount,
            fund_type: input.fund_type,
            advance_date: input.advance_date,
            month,
            note: input.note?.trim() || null,
            created_by: user.id,
          })
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        const r = data as any;
        // Sinh phiếu chi tương ứng (local, như luồng chi lương)
        const code = generateOrderCode('PC');
        const entry: CashbookEntry = {
          id: `cb-${Date.now()}-${String(r.id).slice(0, 6)}`,
          code,
          type: 'expense',
          fund_type: input.fund_type,
          category: 'advance',
          amount,
          partner_name: emp.full_name,
          reference_order_code: `TAMUNG-${month}`,
          note: `Tạm ứng lương tháng ${month} — ${emp.full_name}${input.note?.trim() ? ` (${input.note.trim()})` : ''}`,
          created_at: new Date().toISOString(),
        };
        await supa.from('salary_advances').update({ cashbook_code: code }).eq('id', r.id);
        const rec: SalaryAdvance = {
          id: r.id,
          employee_id: emp.id,
          employee_name: emp.full_name,
          amount,
          fund_type: input.fund_type,
          advance_date: input.advance_date,
          month,
          note: input.note?.trim() || undefined,
          cashbook_code: code,
          created_by: user.id,
          created_at: r.created_at,
        };
        setAdvances((prev) => [rec, ...prev]);
        setCashbook((prev) => [entry, ...prev]);
        db.cashbook.add(entry).catch(() => {});
        markPayrollStale(month);
        return true;
      } catch (err: any) {
        notify(`Ghi tạm ứng thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, user, isOnline, employees, payrollLocks, markPayrollStale, setCashbook]
  );

  // Xóa 1 lần tạm ứng (kèm phiếu chi của nó). Tháng đã chốt/chi thì cấm.
  const deleteAdvance = useCallback(
    async (id: string): Promise<boolean> => {
      if (!requireHrmManager('xóa tạm ứng')) return false;
      const adv = advances.find((a) => a.id === id);
      if (!adv) return false;
      const run = payrollRuns.find((r) => r.month === adv.month);
      if ((run && run.status !== 'draft') || payrollLocks.includes(adv.month)) {
        notify(`Tháng ${adv.month} đã chốt/chi lương — không xóa tạm ứng được!`, 'error');
        return false;
      }
      if (!isOnline || !supa) {
        notify('Cần Online mới xóa được!', 'error');
        return false;
      }
      if (!await confirmDialog(`Xóa lần tạm ứng ${adv.amount.toLocaleString('vi-VN')}đ của ${adv.employee_name || ''} ngày ${adv.advance_date}? (Xóa luôn phiếu chi ${adv.cashbook_code || ''})`)) return false;
      try {
        const { error } = await supa.from('salary_advances').delete().eq('id', id);
        if (error) throw new Error(error.message);
        setAdvances((prev) => prev.filter((a) => a.id !== id));
        if (adv.cashbook_code) {
          const target = cashbook.find((e) => e.code === adv.cashbook_code);
          setCashbook((prev) => prev.filter((e) => e.code !== adv.cashbook_code));
          if (target) db.cashbook.delete(target.id).catch(() => {});
        }
        markPayrollStale(adv.month);
        return true;
      } catch (err: any) {
        notify(`Xóa tạm ứng thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, isOnline, advances, payrollRuns, payrollLocks, cashbook, markPayrollStale, setCashbook]
  );

  // Lập phiếu chi TẠM ỨNG tay ở Sổ quỹ + link thẳng vào bảng lương tháng hiện tại.
  // (Phiếu tay chỉ lưu local nên phải ghi thêm bản salary_advances trên server,
  //  nếu không bảng lương — đọc từ server — sẽ không thấy.)
  const addAdvanceVoucher = useCallback(
    async (input: { employee_id: string; amount: number; fund_type: 'cash' | 'bank'; note?: string }): Promise<boolean> => {
      if (!requireHrmManager('ghi tạm ứng')) return false;
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước!', 'error');
        setLoginOpen(true);
        return false;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Mở ca mới trước khi lập phiếu.', 'error');
        return false;
      }
      const emp = employees.find((e) => e.id === input.employee_id);
      if (!emp || emp.status !== 'active') {
        notify('Chọn nhân viên đang làm việc!', 'error');
        return false;
      }
      const amount = Math.max(0, Math.round(Number(input.amount) || 0));
      if (amount <= 0) {
        notify('Nhập số tiền tạm ứng!', 'error');
        return false;
      }
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới ghi tạm ứng được!', 'error');
        return false;
      }
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const month = todayStr.slice(0, 7);
      if (payrollLocks.includes(month)) {
        notify(`Tháng ${month} đã chốt lương — không ghi tạm ứng được!`, 'error');
        return false;
      }
      try {
        const code = generateOrderCode('PC');
        const createdAt = new Date().toISOString();
        const { data, error } = await supa
          .from('salary_advances')
          .insert({
            employee_id: emp.id,
            amount,
            fund_type: input.fund_type,
            advance_date: todayStr,
            month,
            note: input.note?.trim() || null,
            cashbook_code: code,
            created_by: user.id,
          })
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        const r = data as any;
        const entry: CashbookEntry = {
          id: `cb-${Date.now()}-${String(r.id).slice(0, 6)}`,
          code,
          type: 'expense',
          fund_type: input.fund_type,
          category: 'advance',
          amount,
          partner_name: emp.full_name,
          reference_order_code: `TAMUNG-${month}`,
          note: `Tạm ứng lương tháng ${month} — ${emp.full_name}${input.note?.trim() ? ` (${input.note.trim()})` : ''}`,
          created_at: createdAt,
        };
        const rec: SalaryAdvance = {
          id: r.id,
          employee_id: emp.id,
          employee_name: emp.full_name,
          amount,
          fund_type: input.fund_type,
          advance_date: todayStr,
          month,
          note: input.note?.trim() || undefined,
          cashbook_code: code,
          created_by: user.id,
          created_at: r.created_at,
        };
        setAdvances((prev) => [rec, ...prev]);
        setCashbook((prev) => [entry, ...prev]);
        db.cashbook.add(entry).catch(() => {});
        markPayrollStale(month);
        return true;
      } catch (err: any) {
        notify(`Ghi tạm ứng thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, user, isOnline, employees, payrollLocks, currentShift, markPayrollStale, setLoginOpen, setCashbook]
  );

  // Cho nghỉ việc / đi làm lại (giữ lịch sử công + lương)
  const setEmployeeStatus = useCallback(
    async (id: string, status: 'active' | 'inactive'): Promise<boolean> => {
      if (!requireHrmManager(status === 'inactive' ? 'cho nhân viên nghỉ việc' : 'kích hoạt lại nhân viên')) return false;
      if (!isOnline || !supa) {
        notify('Cần Online mới đổi trạng thái được!', 'error');
        return false;
      }
      if (status === 'inactive' && !(await confirmDialog('Cho nhân viên này nghỉ việc? (Giữ lại lịch sử công/lương)', { title: 'Cho nghỉ việc', confirmLabel: 'Cho nghỉ việc' }))) return false;
      try {
        const { error } = await supa.from('employees').update({ status }).eq('id', id);
        if (error) throw new Error(error.message);
        setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));
        const cur = employees.find((e) => e.id === id);
        if (cur) db.employees.put({ ...cur, status }).catch(() => {});
        return true;
      } catch (err: any) {
        notify(`Đổi trạng thái thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, isOnline, employees]
  );

  // Chốt / mở chốt bảng công tháng (manager/admin). Trigger server cưỡng chế song song.
  const setMonthLock = useCallback(
    async (month: string, locked: boolean): Promise<boolean> => {
      if (!requireHrmManager('chốt bảng công')) return false;
      try {
        if (!supa || !user) return false;
        if (locked) {
          const { error } = await supa.from('payroll_locks').upsert({ month, locked_by: user.id });
          if (error) throw new Error(error.message);
          setPayrollLocks((prev) => (prev.includes(month) ? prev : [...prev, month]));
        } else {
          const { error } = await supa.from('payroll_locks').delete().eq('month', month);
          if (error) throw new Error(error.message);
          setPayrollLocks((prev) => prev.filter((m) => m !== month));
        }
        return true;
      } catch (err: any) {
        notify(`Chốt/mở bảng công thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [supa, user, requireHrmManager]
  );

  // Chấm/sửa 1 ô công ngày (upsert theo cặp nhân viên/ngày). OT + ghi chú nhập thẳng tại ô.
  const markDay = useCallback(
    async (input: MarkDayInput): Promise<boolean> => {
      if (!input.employee_id || !input.work_date) return false;
      if (!requireHrmManager('chấm công')) return false;
      const lockMonth = (input.work_date || '').slice(0, 7);
      if (lockMonth && payrollLocks.includes(lockMonth)) {
        notify(`Bảng công tháng ${lockMonth} đã chốt lương — liên hệ Admin để mở khóa!`, 'error');
        return false;
      }
      const canWriteServer = !!supa && !!user && isOnline;
      const ot = Math.max(0, Number(input.ot_hours) || 0);
      const note = input.note?.trim() || null;
      const serverCols = { employee_id: input.employee_id, work_date: input.work_date, status: input.status, ot_hours: ot, note };
      const now = new Date().toISOString();

      const found = attendanceDays.find((a) => a.employee_id === input.employee_id && a.work_date === input.work_date);
      if (found) {
        if (found.status === input.status && (found.ot_hours || 0) === ot && (found.note || '') === (note || '')) return true;
        const updated: AttendanceDay = { ...found, status: input.status, ot_hours: ot, note: note ?? undefined, synced: false };
        if (found.synced && isUuid(found.id) && canWriteServer && supa) {
          const { error } = await supa.from('attendance_days').update(serverCols).eq('id', found.id);
          if (error) {
            notify(`Lưu server thất bại: ${vietnamizeError(error)}`, 'error');
            return false;
          }
          updated.synced = true;
        }
        setAttendanceDays((prev) => prev.map((a) => (a.id === found.id ? updated : a)));
        db.attendanceDays.put(updated).catch(() => {});
        markPayrollStale(lockMonth);
        return true;
      }

      let rec: AttendanceDay = {
        id: `day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        employee_id: input.employee_id,
        work_date: input.work_date,
        status: input.status,
        ot_hours: ot,
        note: note ?? undefined,
        created_at: now,
        synced: false,
      };
      if (canWriteServer && supa) {
        try {
          const { data, error } = await supa.from('attendance_days').insert(serverCols).select('id').single();
          if (!error && data) rec = { ...rec, id: (data as any).id, synced: true };
        } catch {
          /* rớt mạng giữa chừng -> giữ bản local chưa sync */
        }
      }
      setAttendanceDays((prev) => [rec, ...prev]);
      db.attendanceDays.add(rec).catch(() => {});
      markPayrollStale(lockMonth);
      return true;
    },
    [requireHrmManager, attendanceDays, supa, user, isOnline, payrollLocks, markPayrollStale]
  );

  const clearDay = useCallback(
    async (id: string): Promise<boolean> => {
      if (!requireHrmManager('xóa chấm công')) return false;
      const rec = attendanceDays.find((a) => a.id === id);
      if (!rec) return false;
      const lockMonth = (rec.work_date || '').slice(0, 7);
      if (lockMonth && payrollLocks.includes(lockMonth)) {
        notify(`Bảng công tháng ${lockMonth} đã chốt lương — liên hệ Admin để mở khóa!`, 'error');
        return false;
      }
      if (rec.synced && isUuid(id)) {
        if (!supa || !isOnline) {
          notify('Dòng này đã đồng bộ server — cần Online mới xóa được!', 'error');
          return false;
        }
        const { error } = await supa.from('attendance_days').delete().eq('id', id);
        if (error) {
          notify(`Xóa server thất bại: ${vietnamizeError(error)}`, 'error');
          return false;
        }
      }
      setAttendanceDays((prev) => prev.filter((a) => a.id !== id));
      db.attendanceDays.delete(id).catch(() => {});
      markPayrollStale(lockMonth);
      return true;
    },
    [requireHrmManager, attendanceDays, supa, isOnline, payrollLocks, markPayrollStale]
  );

  // Đẩy các ô công + đơn chưa sync lên server (gọi khi vừa online / vừa login)
  const syncHrmPending = useCallback(async (): Promise<void> => {
    if (!supa || !user || !isOnline) return;
    if (profile?.role !== 'admin' && profile?.role !== 'manager') return;
    for (const rec of attendanceDays.filter((a) => !a.synced)) {
      try {
        if (isUuid(rec.id)) {
          const { error } = await supa
            .from('attendance_days')
            .update({
              employee_id: rec.employee_id,
              work_date: rec.work_date,
              status: rec.status,
              ot_hours: rec.ot_hours || 0,
              note: rec.note || null,
            })
            .eq('id', rec.id);
          if (!error) {
            const updated = { ...rec, synced: true };
            db.attendanceDays.put(updated).catch(() => {});
            setAttendanceDays((prev) => prev.map((a) => (a.id === rec.id ? updated : a)));
          }
          continue;
        }
        const { data, error } = await supa
          .from('attendance_days')
          .insert({
            employee_id: rec.employee_id,
            work_date: rec.work_date,
            status: rec.status,
            ot_hours: rec.ot_hours || 0,
            note: rec.note || null,
          })
          .select('id')
          .single();
        if (!error && data) {
          const sid = (data as any).id as string;
          const updated = { ...rec, id: sid, synced: true };
          db.attendanceDays.delete(rec.id).catch(() => {});
          db.attendanceDays.add(updated).catch(() => {});
          setAttendanceDays((prev) => prev.map((a) => (a.id === rec.id ? updated : a)));
        }
      } catch {
        /* giữ lại thử đợt sau */
      }
    }
  }, [attendanceDays, supa, user, profile, isOnline]);

  // --- Bảng lương tháng (server-only, chỉ manager): nháp -> chốt (khóa tháng) -> chi (phiếu chi) ---

  // --- Bảng lương tháng (server-only, chỉ manager): nháp -> chốt 1 nút (khóa công + chốt lương) -> chi ---

  // Lõi dựng nháp bảng lương từ số liệu mới nhất (trả về runId, null khi tháng đã chi)
  const buildDraftPayroll = useCallback(
    async (month: string): Promise<string | null> => {
      if (!supa || !user) return null;
      const [y, m] = month.split('-').map(Number);
      const toDate = new Date(y, m, 0).getDate();
      const from = `${month}-01`;
      const to = `${month}-${String(toDate).padStart(2, '0')}`;
      const { data: att, error: attErr } = await supa
        .from('attendance_days')
        .select('*')
        .gte('work_date', from)
        .lte('work_date', to);
      if (attErr) throw new Error(attErr.message);
      const rows = (att as any[]) || [];
      const byEmp = new Map<string, any[]>();
      for (const r of rows) {
        const list = byEmp.get(r.employee_id) || [];
        list.push(r);
        byEmp.set(r.employee_id, list);
      }
      const actives = employees.filter((e) => e.status === 'active');
      if (actives.length === 0) throw new Error('Chưa có nhân viên đang làm việc nào!');
      // Tạm ứng cộng dồn từ model salary_advances (có chứng từ riêng)
      const advByEmp: Record<string, number> = {};
      for (const a of advances) {
        if (a.month !== month) continue;
        advByEmp[a.employee_id] = (advByEmp[a.employee_id] || 0) + (Number(a.amount) || 0);
      }
      const built = actives.map((emp) => {
        const mine: AttendanceDay[] = (byEmp.get(emp.id) || []).map((r) => ({
          id: r.id,
          employee_id: r.employee_id,
          work_date: r.work_date,
          status: (r.status ?? 'present') as AttendanceStatus,
          ot_hours: Number(r.ot_hours ?? r.overtime_hours) || 0,
          created_at: r.created_at ?? new Date().toISOString(),
          synced: true,
        }));
        return { emp, item: buildPayrollItem(emp, mine, advByEmp) };
      });
      // Xóa nháp/cũ chưa chi của tháng này (nếu có) rồi tạo mới
      const { data: existing } = await supa.from('payroll_runs').select('id, status').eq('month', month).maybeSingle();
      if (existing) {
        if ((existing as any).status === 'paid') return null;
        const { error: delErr } = await supa.from('payroll_runs').delete().eq('id', (existing as any).id);
        if (delErr) throw new Error(delErr.message);
      }
      const totals = built.reduce(
        (acc, b) => ({
          days: acc.days + b.item.days,
          gross: acc.gross + b.item.gross,
          allowance: acc.allowance + b.item.allowance,
          advance: acc.advance + b.item.advance,
          net: acc.net + b.item.net,
        }),
        { days: 0, gross: 0, allowance: 0, advance: 0, net: 0 }
      );
      const { data: run, error: runErr } = await supa
        .from('payroll_runs')
        .insert({
          month,
          status: 'draft',
          headcount: built.length,
          total_days: Math.round(totals.days * 100) / 100,
          total_gross: totals.gross,
          total_allowance: totals.allowance,
          total_deduction: 0,
          total_advance: totals.advance,
          total_net: totals.net,
          created_by: user.id,
        })
        .select('id')
        .single();
      if (runErr || !run) throw new Error(runErr?.message || 'Tạo bảng lương thất bại.');
      const runId = (run as any).id as string;
      if (built.length > 0) {
        const { error: itemErr } = await supa
          .from('payroll_items')
          .insert(built.map((b) => ({ ...b.item, run_id: runId })));
        if (itemErr) throw new Error(itemErr.message);
      }
      return runId;
    },
    [supa, user, employees, advances]
  );

  // Lập / tạo lại nháp (nút Tạo lại) — bảng lương chỉ đọc, không sửa tay từng dòng
  const generatePayroll = useCallback(
    async (month: string): Promise<boolean> => {
      if (!requireHrmManager('lập bảng lương')) return false;
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới lập bảng lương được!', 'error');
        return false;
      }
      const existing = payrollRuns.find((r) => r.month === month);
      if (existing?.status === 'paid') {
        notify(`Tháng ${month} đã chi lương — không tạo lại được!`, 'error');
        return false;
      }
      if (existing && !await confirmDialog(`Tạo lại bảng lương tháng ${month}? (Xóa bản hiện tại)`)) return false;
      try {
        const runId = await buildDraftPayroll(month);
        if (!runId) return false;
        await refreshHrm();
        setPayrollStaleMonths((prev) => prev.filter((m) => m !== month));
        return true;
      } catch (err: any) {
        notify(`Lập bảng lương thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, user, isOnline, payrollRuns, buildDraftPayroll, refreshHrm]
  );

  // CHỐT THÁNG — 1 nút duy nhất: dựng lại bảng từ số mới nhất + khóa chấm công + chốt lương
  const lockMonth = useCallback(
    async (month: string): Promise<boolean> => {
      if (!requireHrmManager('chốt tháng')) return false;
      if (!isOnline || !supa || !user) {
        notify('Cần Online mới chốt được!', 'error');
        return false;
      }
      const existing = payrollRuns.find((r) => r.month === month);
      if (existing?.status === 'paid') {
        notify(`Tháng ${month} đã chi lương — không chốt lại được!`, 'error');
        return false;
      }
      if (!await confirmDialog(`Chốt tháng ${month}? (Dựng lại bảng lương từ số mới nhất, khóa chấm công + chốt lương)`)) return false;
      try {
        const runId = await buildDraftPayroll(month);
        if (!runId) return false;
        const locked = await setMonthLock(month, true);
        if (!locked) return false;
        const { error } = await supa
          .from('payroll_runs')
          .update({ status: 'finalized', finalized_at: new Date().toISOString() })
          .eq('id', runId);
        if (error) throw new Error(error.message);
        await refreshHrm();
        setPayrollStaleMonths((prev) => prev.filter((m) => m !== month));
        return true;
      } catch (err: any) {
        notify(`Chốt tháng thất bại: ${vietnamizeError(err)}`, 'error');
        return false;
      }
    },
    [requireHrmManager, supa, user, isOnline, payrollRuns, buildDraftPayroll, setMonthLock, refreshHrm]
  );

  // Mở lại: finalized -> draft + mở khóa tháng (đã chi thì không mở được)
  const reopenPayroll = useCallback(
    async (runId: string): Promise<boolean> => {
      if (!requireHrmManager('mở lại bảng lương') || !supa) return false;
      const run = payrollRuns.find((r) => r.id === runId);
      if (!run || run.status !== 'finalized') {
        notify('Chỉ mở lại được bảng đã chốt (chưa chi)!', 'error');
        return false;
      }
      if (!await confirmDialog(`Mở lại bảng lương tháng ${run.month} để sửa? (Mở khóa chấm công)`)) return false;
      const unlocked = await setMonthLock(run.month, false);
      if (!unlocked) return false;
      const { error } = await supa.from('payroll_runs').update({ status: 'draft', finalized_at: null }).eq('id', runId);
      if (error) {
        notify(`Mở lại thất bại: ${vietnamizeError(error)}`, 'error');
        return false;
      }
      await refreshHrm();
      return true;
    },
    [requireHrmManager, supa, payrollRuns, setMonthLock, refreshHrm]
  );

  function formatPayrollTotal(items: { net: number }[]): string {
    const total = items.reduce((s, i) => s + i.net, 0);
    return `${total.toLocaleString('vi-VN')}đ`;
  }

  // Chi lương: finalized -> paid + sinh phiếu chi sổ quỹ từng người
  const payPayroll = useCallback(
    async (runId: string, fund: 'cash' | 'bank'): Promise<boolean> => {
      if (!requireHrmManager('chi lương') || !supa) return false;
      const run = payrollRuns.find((r) => r.id === runId);
      if (!run || run.status !== 'finalized') {
        notify('Chỉ chi được bảng đã chốt!', 'error');
        return false;
      }
      const items = payrollItems.filter((i) => i.run_id === runId && !i.paid && i.net > 0);
      if (items.length === 0) {
        notify('Không còn dòng lương nào cần chi!', 'error');
        return false;
      }
      if (!await confirmDialog(`Chi lương tháng ${run.month} cho ${items.length} người (${formatPayrollTotal(items)}) qua ${fund === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}?`)) return false;
      try {
        for (const it of items) {
          const code = generateOrderCode('PC');
          const entry: CashbookEntry = {
            id: `cb-${Date.now()}-${it.id.slice(0, 6)}`,
            code,
            type: 'expense',
            fund_type: fund,
            category: 'labor',
            amount: it.net,
            partner_name: it.employee_name,
            reference_order_code: `LUONG-${run.month}`,
            note: `Chi lương tháng ${run.month} — ${it.employee_name} (${it.days} công)`,
            created_at: new Date().toISOString(),
          };
          const { error: itemErr } = await supa
            .from('payroll_items')
            .update({ paid: true, cashbook_code: code })
            .eq('id', it.id);
          if (itemErr) throw new Error(itemErr.message);
          setPayrollItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, paid: true, cashbook_code: code } : p)));
          setCashbook((prev) => [entry, ...prev]);
          db.cashbook.add(entry).catch(() => {});
        }
        await supa.from('payroll_runs').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', runId);
        await refreshHrm();
        return true;
      } catch (err: any) {
        notify(`Chi lương thất bại: ${vietnamizeError(err)}`, 'error');
        await refreshHrm();
        return false;
      }
    },
    [requireHrmManager, supa, payrollRuns, payrollItems, refreshHrm, setCashbook]
  );

  // Vừa login / vừa online lại -> kéo HRM về, đẩy tồn máy lên.
  // Chỉ phụ thuộc user/isOnline (callbacks qua ref) để tránh vòng lặp:
  // refresh/sync tự setState -> đổi identity callback -> effect chạy lại -> "Đang đồng bộ" nhấp nháy mãi.
  const refreshHrmRef = useRef(refreshHrm);
  const syncHrmPendingRef = useRef(syncHrmPending);
  // Giữ ref trỏ callback mới nhất bằng effect mỗi render (không gán ref trong render —
  // react-hooks/refs). Không đưa callbacks vào dep array bên dưới để tránh vòng lặp.
  useEffect(() => {
    refreshHrmRef.current = refreshHrm;
    syncHrmPendingRef.current = syncHrmPending;
  });
  useEffect(() => {
    if (user && isOnline) {
      Promise.resolve().then(() => {
        refreshHrmRef.current();
        syncHrmPendingRef.current();
      });
    }
  }, [user, isOnline]);

  const value: HrmSlice = {
    employees,
    attendanceDays,
    setEmployees,
    setAttendanceDays,
    setPayrollLocks,
    setPayrollRuns,
    setPayrollItems,
    setAdvances,
    setPayrollStaleMonths,
    setAccounts,
    setHrmError,
    hrmLoading,
    hrmError,
    refreshHrm,
    accounts,
    saveEmployee,
    setEmployeeStatus,
    createEmployeeWithAccount,
    createAccountForEmployee,
    resetEmployeePassword,
    markDay,
    clearDay,
    payrollLocks,
    setMonthLock,
    payrollRuns,
    payrollItems,
    advances,
    addAdvance,
    deleteAdvance,
    addAdvanceVoucher,
    payrollStaleMonths,
    generatePayroll,
    lockMonth,
    reopenPayroll,
    payPayroll,
  };
  return <HrmContext.Provider value={value}>{children}</HrmContext.Provider>;
}

export function useHrm(): HrmSlice {
  const ctx = useContext(HrmContext);
  if (!ctx) throw new Error('useHrm must be used within HrmProvider');
  return ctx;
}
