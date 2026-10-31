// Phiếu công & lương cá nhân (A4 dọc) — dựng số liệu thuần, không React/Supabase.
// Quản lý in cho từng nhân viên; tháng chưa chốt vẫn in được nhưng ghi rõ "Tạm tính".
// Nguồn lương: đúng run/items mà bảng lương đang hiển thị (tránh lệch với màn hình).

import {
  ATTENDANCE_STATUS_META,
  HR_POLICY,
  attendanceModeOf,
  buildPayrollItem,
  monthDays,
  otPay,
  todayIso,
} from './hrm.ts';
import type {
  AttendanceDay,
  AttendanceStatus,
  Employee,
  PayrollItem,
  PayrollRun,
  SalaryAdvance,
  SalaryType,
} from './hrm.ts';

export type SlipSource = 'final' | 'draft' | 'none';

export interface SlipPayroll {
  salaryType: SalaryType;
  baseSalary: number;
  days: number;
  // Lương tháng chỉ trả tối đa 26 công (lib/hrm.ts buildPayrollItem) — hiển thị tách
  // "công chấm" và "công tính lương" để nhân viên không tưởng bị trừ oan.
  payrollDays: number;
  otHours: number;
  // Tiền OT đã nằm TRONG gross — chỉ hiển thị "trong đó", không cộng thêm.
  otAmount: number;
  gross: number;
  allowance: number;
  deduction: number;
  advance: number;
  net: number;
  paid: boolean;
  cashbookCode?: string;
  note?: string;
}

export interface SlipDay {
  iso: string;
  d: number;
  dow: number;
  record?: AttendanceDay;
}

export interface SlipAdvanceLine {
  date: string;
  amount: number;
  fund: 'cash' | 'bank';
  cashbookCode?: string;
  note?: string;
}

export interface EmployeeSlip {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  month: string;
  source: SlipSource;
  statusLabel: string;
  runStatus?: PayrollRun['status'];
  finalSnapshot: boolean;
  payroll: SlipPayroll;
  calendar: { padStart: number; weeks: (SlipDay | null)[][] };
  totals: {
    present: number;
    half: number;
    paidLeave: number;
    unpaidLeave: number;
    holiday: number;
    days: number;
    otHours: number;
    unmarkedWorkDays: number;
    absentDays: number;
  };
  advances: {
    lines: SlipAdvanceLine[];
    total: number;
    snapshot: number;
    mismatch: boolean;
    hiddenCount: number;
  };
  warnings: string[];
  salaryProfileChanged: boolean;
}

export interface BuildEmployeeSlipInput {
  employee: Employee;
  month: string; // YYYY-MM
  attendanceDays: AttendanceDay[];
  run?: PayrollRun; // đúng run parent đang hiển thị
  items: PayrollItem[]; // items của run đó
  advances: SalaryAdvance[];
  stale?: boolean;
  offline?: boolean;
  today?: string;
  attendanceWindowStart?: string; // work_date cũ nhất đang tải (limit 2000 dòng)
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function normalizeItem(it: Omit<PayrollItem, 'id' | 'run_id'>): Omit<PayrollItem, 'id' | 'run_id'> {
  return {
    ...it,
    base_salary: round(num(it.base_salary)),
    days: round2(num(it.days)),
    ot_hours: round2(num(it.ot_hours)),
    gross: round(num(it.gross)),
    allowance: round(num(it.allowance)),
    deduction: round(num(it.deduction)),
    advance: round(num(it.advance)),
    net: round(num(it.net)),
    paid: !!it.paid,
  };
}

export function buildEmployeeSlip(input: BuildEmployeeSlipInput): EmployeeSlip {
  const {
    employee,
    month,
    attendanceDays,
    run,
    items,
    advances,
    stale = false,
    offline = false,
    today = todayIso(),
    attendanceWindowStart,
  } = input;

  const mode = attendanceModeOf(employee);
  const warnings: string[] = [];

  // ---- Công của nhân viên trong tháng (trùng ngày: bản created_at mới nhất thắng) ----
  const byDate = new Map<string, AttendanceDay>();
  let duplicateDays = 0;
  for (const d of attendanceDays) {
    if (d.employee_id !== employee.id || !d.work_date.startsWith(month)) continue;
    const prev = byDate.get(d.work_date);
    if (!prev) {
      byDate.set(d.work_date, d);
      continue;
    }
    duplicateDays++;
    if (String(d.created_at || '') >= String(prev.created_at || '')) byDate.set(d.work_date, d);
  }
  const mine = [...byDate.values()].sort((a, b) => a.work_date.localeCompare(b.work_date));

  // ---- Lịch tháng (pad đầu tháng theo T2) ----
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const daysOfMonth = Number.isFinite(year) && Number.isFinite(monthNum) ? monthDays(year, monthNum) : [];
  const padStart = daysOfMonth.length ? (daysOfMonth[0].dow + 6) % 7 : 0;
  const cells: (SlipDay | null)[] = [
    ...Array.from({ length: padStart }, () => null),
    ...daysOfMonth.map((d) => ({ ...d, record: byDate.get(d.iso) })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (SlipDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // ---- Tổng công / OT / vắng ----
  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    half: 0,
    leave_paid: 0,
    leave_unpaid: 0,
    holiday: 0,
  };
  let days = 0;
  let otHours = 0;
  let unpaidLeaveWorkdays = 0;
  for (const d of mine) {
    const meta = ATTENDANCE_STATUS_META[d.status];
    days += meta?.days ?? 0;
    otHours += num(d.ot_hours);
    if (meta && Object.prototype.hasOwnProperty.call(counts, d.status)) counts[d.status] += 1;
    const dow = daysOfMonth.find((x) => x.iso === d.work_date)?.dow;
    if (d.status === 'leave_unpaid' && dow !== undefined && HR_POLICY.workDays.includes(dow)) unpaidLeaveWorkdays += 1;
  }

  const monthStart = `${month}-01`;
  const startFloor = employee.start_date && employee.start_date > monthStart ? employee.start_date : monthStart;
  let unmarkedWorkDays = 0;
  if (mode === 'normal') {
    for (const d of daysOfMonth) {
      if (!HR_POLICY.workDays.includes(d.dow)) continue;
      if (d.iso >= today) break; // daysOfMonth tăng dần
      if (d.iso < startFloor) continue;
      if (!byDate.has(d.iso)) unmarkedWorkDays += 1;
    }
  }
  const totalDays = round2(days);
  const totalOt = round2(otHours);
  const absentDays = round2(unmarkedWorkDays + unpaidLeaveWorkdays);

  // ---- Tạm ứng trong tháng ----
  const monthAdvances = advances
    .filter((a) => a.employee_id === employee.id && a.month === month)
    .sort((a, b) => a.advance_date.localeCompare(b.advance_date) || String(a.created_at).localeCompare(String(b.created_at)));
  const allLines: SlipAdvanceLine[] = monthAdvances.map((a) => ({
    date: a.advance_date,
    amount: round(num(a.amount)),
    fund: a.fund_type,
    cashbookCode: a.cashbook_code,
    note: a.note,
  }));
  const advanceTotal = allLines.reduce((s, a) => s + a.amount, 0);

  // ---- Dòng lương: ưu tiên đúng employee_id, fallback tên chỉ khi duy nhất ----
  const idMatches = items.filter((i) => i.employee_id === employee.id);
  let item: PayrollItem | undefined = idMatches[0];
  let ambiguousName = false;
  if (!item) {
    const nameMatches = items.filter((i) => !i.employee_id && normName(i.employee_name) === normName(employee.full_name));
    if (nameMatches.length === 1) item = nameMatches[0];
    else if (nameMatches.length > 1) ambiguousName = true;
  }
  const duplicateItems = Math.max(0, idMatches.length - 1);

  const draft = normalizeItem(buildPayrollItem(employee, mine, { [employee.id]: advanceTotal }));

  let payrollData: Omit<PayrollItem, 'id' | 'run_id'>;
  let source: SlipSource;
  let statusLabel: string;
  let finalSnapshot = false;
  let missingItem = false;

  if (mode === 'none') {
    payrollData = draft;
    source = 'none';
    statusLabel = 'Không lương · Miễn chấm công';
    if (item) warnings.push('Nhân viên không lương nhưng bảng lương có dòng của họ — phiếu bỏ qua dòng đó.');
  } else if (item && run && run.status !== 'draft') {
    payrollData = normalizeItem(item);
    source = 'final';
    finalSnapshot = true;
    statusLabel = run.status === 'paid' ? 'Chính thức · Đã chi' : 'Chính thức · Đã chốt';
  } else if (item && run && run.status === 'draft') {
    if (stale) {
      payrollData = draft;
      statusLabel = 'Tạm tính · Bảng nháp đã cũ (đã tính lại)';
    } else {
      payrollData = normalizeItem(item);
      statusLabel = 'Tạm tính · Bảng nháp';
    }
    source = 'draft';
  } else {
    payrollData = draft;
    source = 'draft';
    missingItem = !!run;
    statusLabel = run ? 'Tạm tính · Bảng lương không có dòng của nhân viên' : 'Tạm tính · Chưa có bảng lương';
  }

  const salaryType = payrollData.salary_type;
  const baseSalary = round(num(payrollData.base_salary));
  const payrollDays = salaryType === 'monthly' ? Math.min(round2(num(payrollData.days)), HR_POLICY.standardDaysPerMonth) : round2(num(payrollData.days));
  const slipOtHours = round2(num(payrollData.ot_hours));
  const otAmount = round(otPay(salaryType === 'daily' ? baseSalary : baseSalary / HR_POLICY.standardDaysPerMonth, slipOtHours));

  const currentBase = employee.salary_type === 'daily' ? num(employee.daily_wage) : num(employee.monthly_salary);
  const salaryProfileChanged =
    finalSnapshot && mode === 'normal' && (employee.salary_type !== salaryType || round(currentBase) !== baseSalary);

  const snapshotAdvance = round(num(payrollData.advance));
  // Chỉ bảng đã chốt/đã chi mới có "số đã khấu trừ" cố định; nháp luôn tính lại từ tạm ứng hiện tại.
  const mismatch = finalSnapshot && advanceTotal !== snapshotAdvance;

  // ---- Cảnh báo (ưu tiên các dòng in được) ----
  if (offline) warnings.push('Đang offline — dùng dữ liệu đã lưu, có thể chưa đồng bộ.');
  if (month > today.slice(0, 7)) warnings.push('Tháng chưa bắt đầu — chưa có công.');
  if (stale && source === 'draft' && item) warnings.push('Bảng lương nháp đã cũ — phiếu đã tính lại từ công và tạm ứng hiện tại.');
  if (missingItem) warnings.push('Bảng lương tháng này không có dòng của nhân viên — số liệu là tạm tính.');
  if (ambiguousName) warnings.push('Có nhiều dòng lương khớp tên — không xác định được dòng của nhân viên.');
  if (duplicateItems > 0) warnings.push(`Bảng lương có ${duplicateItems + 1} dòng trùng của nhân viên — kiểm tra lại.`);
  if (salaryProfileChanged) warnings.push('Hồ sơ lương đã đổi sau khi chốt — phiếu in theo số đã chốt.');
  if (employee.start_date && employee.start_date.slice(0, 7) > month)
    warnings.push('Nhân viên chưa vào làm trong tháng này.');
  if (employee.status === 'inactive' && !item && !missingItem && mode !== 'none')
    warnings.push('Nhân viên đã nghỉ — không có trong bảng lương; số liệu tạm tính từ công.');
  if (mode === 'fixed' && mine.length > 0) warnings.push('Nhân viên miễn chấm công nhưng có bản ghi công — không dùng để tính lương.');
  if (mode === 'none' && advanceTotal > 0) warnings.push('Nhân viên không lương nhưng có tạm ứng — kiểm tra lại.');
  if (payrollData.net < 0) warnings.push('Thực nhận âm do tạm ứng vượt lương — sẽ cấn trừ kỳ sau.');
  if (mismatch) warnings.push('Tổng tạm ứng hiện tại khác số đã khấu trừ trong bảng lương — phiếu in theo số đã chốt.');
  if (run?.status === 'paid' && item && !item.paid && payrollData.net > 0)
    warnings.push('Bảng lương đã chi nhưng dòng này chưa đánh dấu đã chi.');
  if (duplicateDays > 0) warnings.push(`${duplicateDays} ngày công bị trùng — đã lấy bản ghi mới nhất.`);
  if (
    attendanceWindowStart &&
    month < attendanceWindowStart.slice(0, 7) &&
    !run &&
    mode === 'normal'
  )
    warnings.push('Tháng cũ ngoài dữ liệu đang tải (2.000 dòng công gần nhất) — số liệu có thể thiếu.');

  return {
    employeeId: employee.id,
    employeeCode: employee.code,
    employeeName: employee.full_name,
    month,
    source,
    statusLabel,
    runStatus: run?.status,
    finalSnapshot,
    payroll: {
      salaryType,
      baseSalary,
      days: round2(num(payrollData.days)),
      payrollDays,
      otHours: slipOtHours,
      otAmount,
      gross: round(num(payrollData.gross)),
      allowance: round(num(payrollData.allowance)),
      deduction: round(num(payrollData.deduction)),
      advance: snapshotAdvance,
      net: round(num(payrollData.net)),
      paid: !!payrollData.paid,
      cashbookCode: payrollData.cashbook_code,
      note: payrollData.note,
    },
    calendar: { padStart, weeks },
    totals: {
      present: counts.present,
      half: counts.half,
      paidLeave: counts.leave_paid,
      unpaidLeave: counts.leave_unpaid,
      holiday: counts.holiday,
      days: totalDays,
      otHours: totalOt,
      unmarkedWorkDays,
      absentDays,
    },
    advances: {
      lines: allLines.slice(0, 6),
      total: advanceTotal,
      snapshot: snapshotAdvance,
      mismatch,
      hiddenCount: Math.max(0, allLines.length - 6),
    },
    warnings,
    salaryProfileChanged,
  };
}
