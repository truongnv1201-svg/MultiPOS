# 08 — HRM (`components/hrm/HRMView.tsx`, `lib/hrm.ts`, `lib/store/hrm-slice.tsx`)

## 1. Tab (thực tế 3 tab)
Tổng quan (KPI hôm nay/tháng, lịch, cảnh báo khóa lương) · Nhân sự (hồ sơ, Excel, tạo tài khoản) ·
Chấm công & Lương (lưới tháng + bảng lương + tạm ứng). `leave` không còn màn riêng
(bảng đơn phép đã drop ở migration 0021 — nghỉ = chấm thẳng `PL/KL` trên lưới).

## 2. Entity (`lib/hrm.ts` single source)
- `Employee`: `id · code (NV0001 tự tăng) · full_name · phone? · position? (Quản trị/Quản lý/
  Thu ngân/Kho vận/Thợ) · salary_type (daily|monthly) · daily_wage · monthly_salary ·
  allowance_default · start_date? · status (active|inactive) · user_id? (link tài khoản)`.
- `AttendanceDay`: `employee_id · work_date · status · ot_hours · note?`. Trạng thái:
  `present P=1 · half ½=0.5 · leave_paid PL=1 · leave_unpaid KL=0 · holiday L=1`.
- `SalaryAdvance`: `employee_id · amount · fund (cash|bank) · advance_date ·
  month (YYYY-MM khấu trừ) · cashbook_code?`.
- `PayrollRun`: `month (unique) · status (draft|finalized|paid) · headcount · totals
  (days/gross/allowance/deduction/advance/net)`. `PayrollItem`: snapshot lương + `net`,
  `paid`, `cashbook_code?`.
- `HR_POLICY`: giờ 07:30–11:30/13:00–17:00, làm T2–T7 nghỉ CN, OT ×1.5, phép 12 ngày,
  lương tháng quy 26 ngày. Login NV: `mã.lower + @nv.local`.

## 3. Luồng & công thức
- Chấm công: click ô cycle `P→½→PL→KL→L→xóa`, phím 1–5, nhập OT + ghi chú, chấm nhanh cả hàng,
  lọc chưa chấm/tìm kiếm; upsert theo `(employee_id, work_date)`; offline ghi local `synced=false`.
- Tạm ứng: mỗi lần = 1 bản ghi + 1 phiếu chi `PC/advance`; tự khấu trừ vào lương tháng đó.
- Lương (`buildPayrollItem` thuần): `otPay = round(OT × (lương ngày/8) × 1.5)`;
  ngày: công theo trạng thái + OT + phụ cấp; tháng: `round(lương/26 × công + OT)`;
  `net = round(gross + allowance − deduction − advance)`. Bảng chỉ đọc — sai thì lập lại.
  `draft → Chốt tháng (dựng lại + khóa + finalized) → Chi lương (từng dòng net>0 sinh phiếu chi
  labor, quỹ chọn tay)`. `reopen` chỉ từ finalized; `paid` bất biến. Đổi công/ứng sau lập
  nháp → banner stale yêu cầu lập lại. Tháng trong `payroll_locks` chặn mọi ghi (app + trigger DB).
- Tài khoản: tạo NV + mã tự tăng, gắn Auth qua API admin, reset MK; manager chỉ tạo/reset
  `cashier/worker`.

## 4. API, phân quyền & biên
Đọc/ghi trực tiếp Supabase (`employees`, `attendance_days`, `payroll_*`, `salary_advances`,
`profiles`) + 2 API Next (`create-user`, `reset-password` dùng service_role).
Ghi yêu cầu login + `admin/manager` (app + RLS); lưới khóa khi tháng chốt; NV `inactive`
loại khỏi chấm/ứng/lương. Giới hạn kéo: 2000 dòng công, 500 ứng, 24 kỳ.
Offline: chấm công được (sync sau), nhân sự/ứng/lương bắt online.
