// Phiếu công & lương cá nhân — unit test logic thuần + guard nối dây UI/in.
// Chạy: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEmployeeSlip } from '../lib/hrm-slip.ts';
import { buildPayrollItem } from '../lib/hrm.ts';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');

const emp = (over = {}) => ({
  id: 'e1',
  code: 'NV0001',
  full_name: 'Nguyễn Văn A',
  salary_type: 'daily',
  daily_wage: 300000,
  monthly_salary: 0,
  allowance_default: 0,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const day = (date, status = 'present', ot = 0, over = {}) => ({
  id: `a-${date}-${status}`,
  employee_id: 'e1',
  work_date: date,
  status,
  ot_hours: ot,
  created_at: `${date}T08:00:00Z`,
  ...over,
});

const run = (over = {}) => ({
  id: 'r1',
  month: '2026-03',
  status: 'finalized',
  headcount: 1,
  total_days: 0,
  total_gross: 0,
  total_allowance: 0,
  total_deduction: 0,
  total_advance: 0,
  total_net: 0,
  created_at: '2026-04-01T00:00:00Z',
  ...over,
});

const item = (over = {}) => ({
  id: 'i1',
  run_id: 'r1',
  employee_id: 'e1',
  employee_name: 'Nguyễn Văn A',
  salary_type: 'daily',
  base_salary: 300000,
  days: 10,
  ot_hours: 0,
  gross: 3000000,
  allowance: 0,
  deduction: 0,
  advance: 0,
  net: 3000000,
  paid: false,
  ...over,
});

const adv = (over = {}) => ({
  id: 'ad1',
  employee_id: 'e1',
  amount: 100000,
  fund_type: 'cash',
  advance_date: '2026-03-05',
  month: '2026-03',
  created_at: '2026-03-05T09:00:00Z',
  ...over,
});

const base = (over = {}) => ({
  employee: emp(),
  month: '2026-03',
  attendanceDays: [],
  items: [],
  advances: [],
  today: '2026-04-01',
  ...over,
});

const slipOf = (over = {}) => buildEmployeeSlip(base(over));

describe('buildEmployeeSlip — lịch tháng', () => {
  it('tháng 3/2026 bắt đầu CN: pad 6, 6 tuần, đủ 31 ngày', () => {
    const s = slipOf();
    assert.equal(s.calendar.padStart, 6);
    assert.equal(s.calendar.weeks.length, 6);
    assert.equal(s.calendar.weeks[0][6].d, 1);
    const days = s.calendar.weeks.flat().filter(Boolean);
    assert.equal(days.length, 31);
    assert.equal(days[30].iso, '2026-03-31');
  });

  it('tháng 2/2026 (28 ngày, bắt đầu CN): 5 tuần', () => {
    const s = slipOf({ month: '2026-02' });
    assert.equal(s.calendar.padStart, 6);
    assert.equal(s.calendar.weeks.length, 5);
    assert.equal(s.calendar.weeks.flat().filter(Boolean).length, 28);
  });

  it('tháng 2/2024 nhuận: 29 ngày', () => {
    const s = slipOf({ month: '2024-02' });
    assert.equal(s.calendar.weeks.flat().filter(Boolean).length, 29);
  });
});

describe('buildEmployeeSlip — tổng công/OT', () => {
  it('cộng đúng 5 trạng thái + OT', () => {
    const s = slipOf({
      attendanceDays: [
        day('2026-03-02', 'present', 2),
        day('2026-03-03', 'half', 1),
        day('2026-03-04', 'leave_paid'),
        day('2026-03-05', 'leave_unpaid'),
        day('2026-03-06', 'holiday'),
      ],
    });
    assert.equal(s.totals.present, 1);
    assert.equal(s.totals.half, 1);
    assert.equal(s.totals.paidLeave, 1);
    assert.equal(s.totals.unpaidLeave, 1);
    assert.equal(s.totals.holiday, 1);
    assert.equal(s.totals.days, 3.5);
    assert.equal(s.totals.otHours, 3);
  });

  it('trùng ngày: lấy bản created_at mới nhất + cảnh báo', () => {
    const s = slipOf({
      attendanceDays: [
        day('2026-03-02', 'present', 0, { created_at: '2026-03-02T08:00:00Z' }),
        day('2026-03-02', 'leave_unpaid', 0, { id: 'a2', created_at: '2026-03-02T18:00:00Z' }),
      ],
    });
    assert.equal(s.totals.days, 0);
    assert.ok(s.warnings.some((w) => w.includes('trùng')));
  });
});

describe('buildEmployeeSlip — nguồn lương', () => {
  it('chưa có bảng lương: tạm tính đúng buildPayrollItem', () => {
    const days = [day('2026-03-02'), day('2026-03-03')];
    const s = slipOf({ attendanceDays: days });
    const expected = buildPayrollItem(emp(), days, { e1: 0 });
    assert.equal(s.source, 'draft');
    assert.equal(s.finalSnapshot, false);
    assert.ok(s.statusLabel.includes('Chưa có bảng lương'));
    assert.equal(s.payroll.gross, expected.gross);
    assert.equal(s.payroll.net, expected.net);
    assert.equal(s.payroll.days, 2);
  });

  it('bảng đã chốt: dùng snapshot, không tính lại', () => {
    const s = slipOf({
      run: run(),
      items: [item({ gross: 3000000, advance: 100000, net: 2900000 })],
      attendanceDays: [day('2026-03-02')],
    });
    assert.equal(s.source, 'final');
    assert.equal(s.finalSnapshot, true);
    assert.equal(s.statusLabel, 'Chính thức · Đã chốt');
    assert.equal(s.payroll.gross, 3000000);
    assert.equal(s.payroll.net, 2900000);
    assert.equal(s.payroll.advance, 100000);
  });

  it('bảng đã chi: nhãn đã chi + mã phiếu chi', () => {
    const s = slipOf({
      run: run({ status: 'paid' }),
      items: [item({ paid: true, cashbook_code: 'PC0001' })],
    });
    assert.equal(s.statusLabel, 'Chính thức · Đã chi');
    assert.equal(s.payroll.paid, true);
    assert.equal(s.payroll.cashbookCode, 'PC0001');
  });

  it('bảng nháp cũ (stale): tính lại từ công hiện tại', () => {
    const s = slipOf({
      run: run({ status: 'draft' }),
      items: [item({ gross: 100, net: 100, days: 1 })],
      attendanceDays: [day('2026-03-02'), day('2026-03-03')],
      stale: true,
    });
    assert.equal(s.source, 'draft');
    assert.equal(s.payroll.gross, 600000);
    assert.equal(s.payroll.days, 2);
    assert.ok(s.statusLabel.includes('đã cũ'));
    assert.ok(s.warnings.some((w) => w.includes('đã cũ')));
  });

  it('bảng chốt thiếu dòng của NV: tạm tính + cảnh báo', () => {
    const s = slipOf({ run: run(), items: [item({ employee_id: 'e2', employee_name: 'Người khác' })] });
    assert.equal(s.source, 'draft');
    assert.ok(s.statusLabel.includes('không có dòng'));
    assert.ok(s.warnings.some((w) => w.includes('không có dòng')));
  });

  it('fallback theo tên chỉ khi đúng 1 dòng và employee_id rỗng', () => {
    const one = slipOf({
      run: run(),
      items: [item({ employee_id: undefined, gross: 111, net: 111 })],
    });
    assert.equal(one.finalSnapshot, true);
    assert.equal(one.payroll.gross, 111);

    const two = slipOf({
      run: run(),
      items: [
        item({ id: 'i1', employee_id: undefined }),
        item({ id: 'i2', employee_id: undefined }),
      ],
    });
    assert.equal(two.finalSnapshot, false);
    assert.ok(two.warnings.some((w) => w.includes('khớp tên')));
  });

  it('nhiều dòng cùng employee_id: lấy dòng đầu + cảnh báo trùng', () => {
    const s = slipOf({
      run: run(),
      items: [item({ id: 'i1', gross: 500 }), item({ id: 'i2', gross: 900 })],
    });
    assert.equal(s.payroll.gross, 500);
    assert.ok(s.warnings.some((w) => w.includes('dòng trùng')));
  });

  it('lương tháng: công chấm 27 nhưng công tính lương trần 26', () => {
    const e = emp({ salary_type: 'monthly', daily_wage: 0, monthly_salary: 2600000 });
    const days = [];
    for (let d = 1; d <= 27; d += 1) days.push(day(`2026-03-${String(d).padStart(2, '0')}`));
    const s = slipOf({ employee: e, attendanceDays: days });
    assert.equal(s.payroll.days, 27);
    assert.equal(s.payroll.payrollDays, 26);
    assert.equal(s.payroll.gross, 2600000);
  });

  it('tiền OT nằm trong gross, otAmount chỉ để hiển thị', () => {
    const e = emp({ salary_type: 'monthly', daily_wage: 0, monthly_salary: 2600000 });
    const days = [];
    for (let d = 2; d <= 27; d += 1) days.push(day(`2026-03-${String(d).padStart(2, '0')}`, 'present', d === 2 ? 2 : 0));
    const s = slipOf({ employee: e, attendanceDays: days });
    assert.equal(s.payroll.otHours, 2);
    assert.equal(s.payroll.otAmount, 37500);
    assert.equal(s.payroll.gross, 2637500);
    assert.notEqual(s.payroll.gross, s.payroll.gross + s.payroll.otAmount);
  });
});

describe('buildEmployeeSlip — chế độ miễn chấm công', () => {
  it('fixed: 26 công, nguyên lương tháng + phụ cấp, bỏ qua công lẻ', () => {
    const e = emp({
      attendance_mode: 'fixed',
      salary_type: 'monthly',
      daily_wage: 0,
      monthly_salary: 6000000,
      allowance_default: 200000,
    });
    const s = slipOf({ employee: e, attendanceDays: [day('2026-03-02')] });
    assert.equal(s.payroll.days, 26);
    assert.equal(s.payroll.payrollDays, 26);
    assert.equal(s.payroll.gross, 6000000);
    assert.equal(s.payroll.allowance, 200000);
    assert.ok(s.warnings.some((w) => w.includes('miễn chấm công')));
  });

  it('none: 0đ, vẫn liệt kê tạm ứng + cảnh báo', () => {
    const e = emp({ attendance_mode: 'none' });
    const s = slipOf({ employee: e, advances: [adv()] });
    assert.equal(s.source, 'none');
    assert.equal(s.payroll.net, 0);
    assert.equal(s.advances.lines.length, 1);
    assert.equal(s.advances.total, 100000);
    assert.equal(s.statusLabel, 'Không lương · Miễn chấm công');
    assert.ok(s.warnings.some((w) => w.includes('không lương nhưng có tạm ứng')));
  });
});

describe('buildEmployeeSlip — tạm ứng', () => {
  it('chỉ cộng đúng nhân viên + đúng tháng; tối đa 6 dòng', () => {
    const rows = [];
    for (let i = 1; i <= 7; i += 1) {
      rows.push(adv({ id: `ad${i}`, amount: 10000, advance_date: `2026-03-${String(i).padStart(2, '0')}` }));
    }
    rows.push(adv({ id: 'other-emp', employee_id: 'e2', amount: 999999 }));
    rows.push(adv({ id: 'other-month', month: '2026-02', amount: 888888 }));
    const s = slipOf({ advances: rows });
    assert.equal(s.advances.total, 70000);
    assert.equal(s.advances.lines.length, 6);
    assert.equal(s.advances.hiddenCount, 1);
  });

  it('bảng đã chốt lệch tạm ứng hiện tại: giữ số đã khấu trừ + cảnh báo', () => {
    const s = slipOf({
      run: run(),
      items: [item({ advance: 100000, gross: 3000000, net: 2900000 })],
      advances: [adv({ amount: 150000 })],
    });
    assert.equal(s.payroll.advance, 100000);
    assert.equal(s.advances.total, 150000);
    assert.equal(s.advances.mismatch, true);
    assert.ok(s.warnings.some((w) => w.includes('khác số đã khấu trừ')));
  });

  it('tạm ứng > lương: NET âm + cảnh báo, không kẹp 0', () => {
    const s = slipOf({
      attendanceDays: [day('2026-03-02')],
      advances: [adv({ amount: 500000 })],
    });
    assert.equal(s.payroll.net, -200000);
    assert.ok(s.warnings.some((w) => w.includes('Thực nhận âm')));
  });
});

describe('buildEmployeeSlip — ngày trống', () => {
  it('chỉ đếm ngày làm việc TRƯỚC hôm nay và từ start_date', () => {
    const e = emp({ start_date: '2026-03-10' });
    const s = slipOf({
      employee: e,
      attendanceDays: [day('2026-03-10')],
      today: '2026-03-16',
    });
    // 10,11,12,13,14 (T2-T7) trước 16/3; đã chấm 10 -> còn 4
    assert.equal(s.totals.unmarkedWorkDays, 4);
  });

  it('hôm nay không bị tính trống', () => {
    const s = slipOf({ attendanceDays: [day('2026-03-02')], today: '2026-03-16' });
    // 12 ngày làm việc trước 16/3 (2-7, 9-14), đã chấm 2 -> 11
    assert.equal(s.totals.unmarkedWorkDays, 11);
    assert.equal(s.totals.absentDays, 11);
  });

  it('nghỉ không lương ngày làm việc + ngày trống = vắng', () => {
    const s = slipOf({
      attendanceDays: [day('2026-03-02', 'leave_unpaid')],
      today: '2026-03-04',
    });
    assert.equal(s.totals.unpaidLeave, 1);
    assert.equal(s.totals.unmarkedWorkDays, 1); // 3/3
    assert.equal(s.totals.absentDays, 2);
  });

  it('tháng tương lai: không tính trống + cảnh báo', () => {
    const s = slipOf({ month: '2026-04', today: '2026-03-16' });
    assert.equal(s.totals.unmarkedWorkDays, 0);
    assert.ok(s.warnings.some((w) => w.includes('chưa bắt đầu')));
  });
});

describe('buildEmployeeSlip — cảnh báo dữ liệu', () => {
  it('offline', () => {
    const s = slipOf({ offline: true });
    assert.ok(s.warnings.some((w) => w.includes('offline')));
  });

  it('tháng cũ ngoài cửa sổ tải', () => {
    const s = slipOf({ month: '2025-12', attendanceWindowStart: '2026-01-05', today: '2026-03-16' });
    assert.ok(s.warnings.some((w) => w.includes('Tháng cũ')));
  });

  it('bảng đã chi nhưng dòng chưa đánh dấu chi', () => {
    const s = slipOf({ run: run({ status: 'paid' }), items: [item({ paid: false, net: 100 })] });
    assert.ok(s.warnings.some((w) => w.includes('chưa đánh dấu')));
  });

  it('hồ sơ lương đổi sau khi chốt', () => {
    const s = slipOf({
      employee: emp({ daily_wage: 350000 }),
      run: run(),
      items: [item({ base_salary: 300000 })],
    });
    assert.equal(s.salaryProfileChanged, true);
    assert.ok(s.warnings.some((w) => w.includes('Hồ sơ lương')));
  });

  it('NV chưa vào làm trong tháng', () => {
    const s = slipOf({ employee: emp({ start_date: '2026-04-02' }) });
    assert.ok(s.warnings.some((w) => w.includes('chưa vào làm')));
  });
});

describe('phiếu cá nhân — guard nối dây', () => {
  const modal = read('components/hrm/EmployeeSlipModal.tsx');

  it('modal portal ra body, id riêng, không tái dùng vùng in hóa đơn', () => {
    assert.match(modal, /createPortal\(/);
    assert.match(modal, /document\.body/);
    assert.match(modal, /id="slip-modal-overlay"/);
    assert.match(modal, /id="slip-modal-container"/);
    assert.match(modal, /id="slip-print-area"/);
    assert.ok(!/id="print-area"/.test(modal), 'không được dùng id print-area của hóa đơn');
    assert.ok(!/printTable\(/.test(modal), 'phiếu cá nhân không dùng printTable (A4 ngang)');
  });

  it('modal có chọn NV bằng FilterSelect, 2 nút in, A4 dọc, khôi phục title', () => {
    assert.match(modal, /<FilterSelect/);
    assert.match(modal, /printElementInTab\(/);
    assert.match(modal, /window\.print\(\)/);
    assert.match(modal, /afterprint/);
    assert.match(modal, /@page \{ size: A4 portrait/);
    assert.match(modal, /id="btn-print-slip-mobile"/);
    assert.match(modal, /id="btn-print-slip"/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /id="slip-print-time"/);
  });

  it('AttendancePayrollTab có nút in phiếu + mount có điều kiện', () => {
    const tab = read('components/hrm/tabs/AttendancePayrollTab.tsx');
    assert.match(tab, /In phiếu cá nhân/);
    assert.match(tab, /\{slipOpen && \(/);
    assert.match(tab, /<EmployeeSlipModal/);
    assert.match(tab, /attendanceWindowStart=/);
  });

  it('2 nút in cũ giữ nguyên printTable A4 ngang', () => {
    const attendance = read('components/hrm/tabs/AttendanceTab.tsx');
    const excel = read('lib/excel.ts');
    assert.match(attendance, /onPrint=\{handlePrint\}/);
    assert.match(excel, /printTable/);
    assert.match(excel, /A4 landscape/);
  });

  it('CSS in thêm id slip-* nhưng giữ nguyên hóa đơn', () => {
    const css = read('app/globals.css');
    for (const sel of ['#slip-modal-overlay', '#slip-modal-container', '#slip-print-area', '.slip-no-break']) {
      assert.ok(css.includes(sel), `thiếu selector ${sel}`);
    }
    assert.ok(css.includes('#receipt-modal-overlay'), 'mất CSS hóa đơn #receipt-modal-overlay');
    assert.ok(css.includes('#print-area'), 'mất CSS #print-area');
    assert.ok(!/@page \{\s*size: A4 portrait/.test(css), 'không đặt @page A4 dọc trong globals');
  });

  it('nhân viên tự xem công không dính phiếu in lương', () => {
    const my = read('components/hrm/mobile/MyAttendanceView.tsx');
    assert.ok(!/EmployeeSlipModal|slip-print|buildEmployeeSlip/.test(my));
  });

  it('lib/hrm-slip.ts thuần, không Supabase/React', () => {
    const lib = read('lib/hrm-slip.ts');
    assert.ok(!/from\s+['"][^'"]*supabase/i.test(lib), 'không import Supabase');
    assert.ok(!/'use client'/.test(lib));
    assert.ok(!/from\s+['"]react/i.test(lib));
  });

  it('guard test đã đăng ký trong package.json', () => {
    const pkg = read('package.json');
    assert.match(pkg, /scripts\/hrm-slip-guard\.test\.mjs/);
  });
});
