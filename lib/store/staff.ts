// P3: chuẩn hóa input nhân sự trước khi ghi (tách từ lib/store.tsx).
import type { EmployeeInput } from './types';

export function employeeCols(input: EmployeeInput) {
  return {
    full_name: input.full_name.trim(),
    phone: input.phone?.trim() || null,
    position: input.position?.trim() || null,
    salary_type: input.salary_type,
    daily_wage: Math.max(0, Math.round(Number(input.daily_wage) || 0)),
    monthly_salary: Math.max(0, Math.round(Number(input.monthly_salary) || 0)),
    allowance_default: Math.max(0, Math.round(Number(input.allowance_default) || 0)),
    start_date: input.start_date || null,
    user_id: input.user_id || null,
  };
}
