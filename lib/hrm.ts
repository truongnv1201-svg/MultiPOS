// HRM rebuild — module chuẩn duy nhất cho nhân sự / chấm công / phép / lương.
// Gọn cho shop nhỏ: điểm danh ngày (P/½/PL/KL/L), lương ngày + lương tháng song song.
// Tham khảo MISA AMIS / Base / Tanca: employees là master, duyệt phép tự sinh công.

export type SalaryType = 'daily' | 'monthly';

export interface Employee {
  id: string;
  code: string; // NV0001
  full_name: string;
  phone?: string;
  position?: string;
  salary_type: SalaryType;
  daily_wage: number;
  monthly_salary: number;
  allowance_default: number;
  start_date?: string; // YYYY-MM-DD
  status: 'active' | 'inactive';
  user_id?: string; // link profiles (nếu có login)
  created_at: string;
  synced?: boolean;
}

export type AttendanceStatus = 'present' | 'half' | 'leave_paid' | 'leave_unpaid' | 'holiday';

export const ATTENDANCE_STATUS_META: Record<AttendanceStatus, { label: string; short: string; days: number }> = {
  present: { label: 'Đi làm', short: 'P', days: 1 },
  half: { label: 'Nửa công', short: '½', days: 0.5 },
  leave_paid: { label: 'Nghỉ phép', short: 'PL', days: 1 },
  leave_unpaid: { label: 'Nghỉ không lương', short: 'KL', days: 0 },
  holiday: { label: 'Lễ / Tết', short: 'L', days: 1 },
};

export const ATTENDANCE_STATUS_ORDER: AttendanceStatus[] = ['present', 'half', 'leave_paid', 'leave_unpaid', 'holiday'];

export interface AttendanceDay {
  id: string;
  employee_id: string;
  work_date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  ot_hours: number;
  note?: string;
  created_at: string;
  synced?: boolean;
}

export type PayrollStatus = 'draft' | 'finalized' | 'paid';

// Tạm ứng lương: 1 lần ứng = 1 bản ghi + 1 phiếu chi (category 'advance') trong sổ quỹ.
// Lập bảng lương tự cộng dồn theo (nhân viên, tháng).
export interface SalaryAdvance {
  id: string;
  employee_id: string;
  employee_name?: string; // denormalize hiển thị
  amount: number;
  fund_type: 'cash' | 'bank';
  advance_date: string; // YYYY-MM-DD
  month: string; // YYYY-MM — tháng lương sẽ khấu trừ
  note?: string;
  cashbook_code?: string;
  created_by?: string;
  created_at: string;
}

export interface PayrollRun {
  id: string;
  month: string; // YYYY-MM
  status: PayrollStatus;
  headcount: number;
  total_days: number;
  total_gross: number;
  total_allowance: number;
  total_deduction: number;
  total_advance: number;
  total_net: number;
  created_by?: string;
  created_at: string;
  finalized_at?: string;
  paid_at?: string;
}

export interface PayrollItem {
  id: string;
  run_id: string;
  employee_id?: string;
  employee_name: string;
  salary_type: SalaryType;
  base_salary: number;
  days: number;
  ot_hours: number;
  gross: number;
  allowance: number;
  deduction: number;
  advance: number;
  note?: string;
  net: number;
  paid: boolean;
  cashbook_code?: string;
}

// Danh mục chức vụ chuẩn của cửa hàng (user chốt) — chọn từ list, không gõ tự do
export const POSITION_OPTIONS: string[] = ['Quản trị', 'Quản lý', 'Thu ngân', 'Kho vận', 'Thợ'];

// Đăng nhập bằng mã nhân viên: NV0001 + mật khẩu.
// Supabase Auth bắt buộc email nên app quy mã NV về email nội bộ (không cần mail thật,
// không gửi xác minh): NV0001 -> nv0001@nv.local. Nhập có '@' thì hiểu là email (tài khoản cũ).
export const EMPLOYEE_LOGIN_DOMAIN = 'nv.local';

export function employeeLoginEmail(code: string): string {
  return `${code.trim().toLowerCase()}@${EMPLOYEE_LOGIN_DOMAIN}`;
}

export function normalizeLoginId(id: string): string {
  const v = id.trim();
  return v.includes('@') ? v.toLowerCase() : employeeLoginEmail(v);
}

// Quy định nhân sự mặc định — giữ như đã chốt với user
export const HR_POLICY: {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  workDays: number[];
  otMultiplier: number;
  annualLeaveDays: number;
  standardDaysPerMonth: number;
} = {
  morningStart: '07:30',
  morningEnd: '11:30',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
  workDays: [1, 2, 3, 4, 5, 6], // T2-T7 (0 = CN nghỉ)
  otMultiplier: 1.5,
  annualLeaveDays: 12,
  standardDaysPerMonth: 26, // mẫu số quy lương tháng ra ngày
};

// --- Pure logic (test được, không dính Supabase) ---

// Lương tăng ca = giờ TC × (lương ngày / 8) × 1.5
export function otPay(dailyWage: number, otHours: number): number {
  if (otHours <= 0 || dailyWage <= 0) return 0;
  return Math.round(otHours * (dailyWage / 8) * HR_POLICY.otMultiplier);
}

// Lương 1 ngày công của NV lương-ngày (theo status + OT + phụ cấp ngày)
export function dailyEmployeeDayPay(status: AttendanceStatus, dailyWage: number, otHours: number, allowance = 0): number {
  const base =
    status === 'present' || status === 'leave_paid' || status === 'holiday'
      ? dailyWage
      : status === 'half'
        ? dailyWage / 2
        : 0;
  return Math.round(base + otPay(dailyWage, otHours) + allowance);
}

// Tổng lương tháng của NV lương-tháng:
// lương cứng theo công thực tế (quy theo 26 ngày chuẩn) + OT (quy từ lương tháng) + phụ cấp − tạm ứng − khấu trừ
export function monthlyEmployeePay(
  monthlySalary: number,
  days: number,
  otHours: number,
  allowance = 0,
  advance = 0,
  deduction = 0,
): number {
  const perDay = monthlySalary > 0 ? monthlySalary / HR_POLICY.standardDaysPerMonth : 0;
  const gross = perDay * days + otPay(perDay, otHours) + allowance;
  return Math.round(gross - advance - deduction);
}

export function payrollItemNet(gross: number, allowance: number, deduction: number, advance: number): number {
  return Math.round(gross + allowance - deduction - advance);
}

// Liệt kê ngày trong tháng + ISO, dùng cho lưới chấm công
export function monthDays(year: number, month: number): { d: number; dow: number; iso: string }[] {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const d = i + 1;
    return { d, dow: new Date(year, month - 1, d).getDay(), iso: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  });
}

export function todayIso(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function nextEmployeeCode(existing: Pick<Employee, 'code'>[]): string {
  let max = 0;
  for (const e of existing) {
    const m = /^NV(\d+)$/.exec(e.code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `NV${String(max + 1).padStart(4, '0')}`;
}

// Snapshot 1 dòng lương từ hồ sơ + công tháng (pure — dùng chung cho generatePayroll)
export function buildPayrollItem(
  emp: Employee,
  days: AttendanceDay[],
  advances: Record<string, number> = {},
): Omit<PayrollItem, 'id' | 'run_id'> {
  const dayCount = days.reduce((s, d) => s + (ATTENDANCE_STATUS_META[d.status]?.days ?? 0), 0);
  const ot = days.reduce((s, d) => s + (Number(d.ot_hours) || 0), 0);
  if (emp.salary_type === 'monthly') {
    const perDay = emp.monthly_salary > 0 ? emp.monthly_salary / HR_POLICY.standardDaysPerMonth : 0;
    const gross = Math.round(perDay * dayCount + otPay(perDay, ot));
    const advance = Math.round(advances[emp.id] || 0);
    return {
      employee_id: emp.id,
      employee_name: emp.full_name,
      salary_type: 'monthly',
      base_salary: emp.monthly_salary,
      days: Math.round(dayCount * 100) / 100,
      ot_hours: Math.round(ot * 100) / 100,
      gross,
      allowance: emp.allowance_default || 0,
      deduction: 0,
      advance,
      net: payrollItemNet(gross, emp.allowance_default || 0, 0, advance),
      paid: false,
    };
  }
  const gross = days.reduce(
    (s, d) => s + dailyEmployeeDayPay(d.status, emp.daily_wage, d.ot_hours, 0),
    0,
  );
  const allowance = Math.round((emp.allowance_default || 0) * dayCount);
  const advance = Math.round(advances[emp.id] || 0);
  return {
    employee_id: emp.id,
    employee_name: emp.full_name,
    salary_type: 'daily',
    base_salary: emp.daily_wage,
    days: Math.round(dayCount * 100) / 100,
    ot_hours: Math.round(ot * 100) / 100,
    gross,
    allowance,
    deduction: 0,
    advance,
    net: payrollItemNet(gross, allowance, 0, advance),
    paid: false,
  };
}
