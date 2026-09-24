// Unit test cho lib/hrm.ts (pure logic lương/công, không dính Supabase).
// Chạy: npm test (node --test scripts/pricing.test.mjs scripts/hrm.test.mjs)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HR_POLICY,
  otPay,
  dailyEmployeeDayPay,
  monthlyEmployeePay,
  payrollItemNet,
  monthDays,
  monthKeyOf,
  nextEmployeeCode,
  employeeLoginEmail,
  normalizeLoginId,
  buildPayrollItem,
} from '../lib/hrm.ts';

describe('otPay', () => {
  it('2h OT lương ngày 300k = 112500', () => {
    assert.equal(otPay(300000, 2), 112500);
  });
  it('OT 0/giờ âm/lương 0 -> 0', () => {
    assert.equal(otPay(300000, 0), 0);
    assert.equal(otPay(300000, -1), 0);
    assert.equal(otPay(0, 5), 0);
  });
});

describe('dailyEmployeeDayPay', () => {
  it('present/holiday/leave_paid hưởng nguyên lương', () => {
    assert.equal(dailyEmployeeDayPay('present', 300000, 0), 300000);
    assert.equal(dailyEmployeeDayPay('holiday', 300000, 0), 300000);
    assert.equal(dailyEmployeeDayPay('leave_paid', 300000, 0), 300000);
  });
  it('half hưởng nửa, unpaid = 0 (+OT nếu có)', () => {
    assert.equal(dailyEmployeeDayPay('half', 300000, 0), 150000);
    assert.equal(dailyEmployeeDayPay('leave_unpaid', 300000, 0), 0);
    assert.equal(dailyEmployeeDayPay('leave_unpaid', 300000, 2), 112500);
  });
  it('cộng phụ cấp ngày', () => {
    assert.equal(dailyEmployeeDayPay('present', 300000, 0, 20000), 320000);
  });
});

describe('monthlyEmployeePay', () => {
  it('đủ 26 công = nguyên lương tháng', () => {
    assert.equal(monthlyEmployeePay(7800000, 26, 0), 7800000);
  });
  it('quy theo công thực tế + OT + phụ cấp - ứng - trừ', () => {
    assert.equal(monthlyEmployeePay(7800000, 13, 0), 3900000);
    // 26 công + 2h OT (quy perDay 300k) = 7800000 + 112500
    assert.equal(monthlyEmployeePay(7800000, 26, 2), 7912500);
    assert.equal(monthlyEmployeePay(7800000, 26, 0, 200000, 500000, 100000), 7400000);
  });
  it('payrollItemNet = gross + PC - trừ - ứng', () => {
    assert.equal(payrollItemNet(1000000, 200000, 50000, 100000), 1050000);
  });
});

describe('monthDays / monthKeyOf', () => {
  it('T2/2026 có 28 ngày, ISO chuẩn', () => {
    const days = monthDays(2026, 2);
    assert.equal(days.length, 28);
    assert.equal(days[0].iso, '2026-02-01');
    assert.equal(days[27].iso, '2026-02-28');
  });
  it('năm nhuận T2/2024 có 29 ngày', () => {
    assert.equal(monthDays(2024, 2).length, 29);
  });
  it('monthKeyOf cắt YYYY-MM', () => {
    assert.equal(monthKeyOf('2026-09-24'), '2026-09');
  });
});

describe('nextEmployeeCode', () => {
  it('trống -> NV0001, tiếp nối max', () => {
    assert.equal(nextEmployeeCode([]), 'NV0001');
    assert.equal(nextEmployeeCode([{ code: 'NV0001' }, { code: 'NV0009' }]), 'NV0010');
  });
  it('bỏ qua mã sai định dạng', () => {
    assert.equal(nextEmployeeCode([{ code: 'ABC' }, { code: 'NV0002' }]), 'NV0003');
  });
});

describe('login id', () => {
  it('mã NV -> email nội bộ, email giữ nguyên (lowercase)', () => {
    assert.equal(employeeLoginEmail('NV0001'), 'nv0001@nv.local');
    assert.equal(normalizeLoginId('NV0001'), 'nv0001@nv.local');
    assert.equal(normalizeLoginId('Admin@X.com'), 'admin@x.com');
    assert.ok(HR_POLICY.standardDaysPerMonth === 26);
  });
});

describe('buildPayrollItem', () => {
  it('NV lương ngày: công + OT + phụ cấp theo công', () => {
    const emp = { id: 'e1', full_name: 'Thợ A', salary_type: 'daily', daily_wage: 300000, allowance_default: 10000 };
    const days = [
      { status: 'present', ot_hours: 0 },
      { status: 'present', ot_hours: 1 },
      { status: 'half', ot_hours: 0 },
    ];
    const it = buildPayrollItem(emp, days, {});
    assert.equal(it.days, 2.5);
    assert.equal(it.ot_hours, 1);
    assert.equal(it.gross, 300000 + (300000 + 56250) + 150000);
    assert.equal(it.allowance, 25000);
    assert.equal(it.net, it.gross + 25000);
    assert.equal(it.paid, false);
  });
  it('NV lương tháng: quy 26 ngày chuẩn, trừ tạm ứng', () => {
    const emp = { id: 'e2', full_name: 'KT B', salary_type: 'monthly', monthly_salary: 7800000, allowance_default: 0 };
    const days = Array.from({ length: 5 }, () => ({ status: 'present', ot_hours: 0 }));
    const it = buildPayrollItem(emp, days, { e2: 500000 });
    assert.equal(it.gross, 1500000);
    assert.equal(it.advance, 500000);
    assert.equal(it.net, 1000000);
  });
});
