# 07 — Công trình (`components/projects/ProjectsView.tsx`)

## 1. Mục đích
Thi công theo 3 phase + P&L. Một màn 2 cột: trái danh sách (mã, phase/3, tên, KH,
dự toán, lãi), phải stepper 4 phase bấm được + bảng vật tư/thợ + thẻ P&L + modal tạo mới.

## 2. Entity `Project`
`id · code (CT-YYMMDD-XXXX) · name · customer_id/name · address · phase (1|2|3|4) ·
estimated_revenue · settled_revenue · materials[] {product_id, sku, name, quantity, unit,
unit_cost, total_cost} · workers[] {id, worker_name, role, days_worked, daily_wage,
allowance, total_wage} · other_costs · material_cost_total · labor_cost_total · total_cost ·
actual_profit · status (planning|in_progress|completed) · created_at`.
4 phase: 1 Báo giá dự toán → 2 Xuất kho vật tư → 3 Chấm công thợ → 4 Nghiệm thu & P&L.

## 3. Nhập liệu (Phase 2 + 3)
- **Xuất vật tư** (nút ở thẻ vật tư, modal): chọn hàng `goods/area` trong kho + SL →
  trừ tồn thật + thẻ kho `export_project` theo mã CT, đơn giá vốn = `avg_cost`;
  chặn SL ≤ 0, tồn không đủ, hàng service/combo; cần login + ca mở.
  Gỡ dòng → hoàn lại kho + thẻ `return`.
- **Thêm thợ** (nút ở thẻ nhân công, modal): **chọn từ hồ sơ nhân sự** (NV active) →
  tự link `employee_id/code` + điền việc theo chức vụ, lương theo ngày
  (lương tháng quy /26); thợ ngoài gõ tên trực tiếp (không link, nhập tay).
  `total = ngày × lương + phụ cấp` (xem trước trong modal). Bảng hiện chip mã NV khi có link.
  Gỡ dòng theo id.
- Mọi thêm/gỡ tính lại `vật tư + nhân công + chi khác = tổng chi`, `lãi = quyết toán − tổng chi`.

## 4. Luồng tiền (báo giá → cọc/đợt → quyết toán)
- **Báo giá lệch giá chốt:** bấm vào số quyết toán ở banner để sửa độc lập `dự toán /
  quyết toán / chi khác` (`updateProjectFinance`, tính lại lãi).
- **Không qua báo giá:** lúc lập dự án tích "vào thẳng Thi công" → `phase=2`, `in_progress`.
- **Thu tiền theo đợt (cọc/tạm ứng):** trong lúc thi công nút **Thu cọc/đợt**;
  sang Nghiệm thu nút đổi thành **Thu quyết toán** (mặc định = phần còn lại).
  Mỗi lần thu sinh phiếu thu `PT/deposit` theo mã CT (tiền mặt cộng vào ca) + cộng dồn
  `Đã thu trước`. Thu vượt phần còn lại phải xác nhận thêm. Cọc/đợt **không** trừ vào lãi;
  hiển thị `Đã thu trước` + `Còn phải thu = quyết toán − đã thu` ở banner và P&L.

## 4. Công thức
`total_cost dòng vật tư = qty × unit_cost`
`total_wage dòng thợ = ngày × lương ngày + phụ cấp`
`total_cost = vật tư + nhân công + chi khác`
`actual_profit = settled_revenue − total_cost`, `margin = profit / settled × 100%`
(view SQL `project_pnl` tính tương tự). Tạo mới: `phase=1`, `settled=estimated`,
`status=planning`; lên 2 → `in_progress`, lên 3 → `completed`.

## 5. Phân quyền, API & biên
Không check quyền trong view (ai cũng tạo/chuyển phase/xuất/thêm được) — muốn siết
theo Admin/Quản lý thì làm tiếp. Lưu local (`exportProjectMaterial/addProjectWorker/
removeProjectLine` + Dexie); server có sẵn trigger trừ kho + view P&L nhưng frontend
chưa insert server — đa máy chưa đồng bộ công trình.
Ghi chú: chuyển phase nhảy tự do (không bắt tuần tự/không chặn thiếu vật tư-công);
`settled_revenue`/`other_costs` tạo xong không sửa được trên UI (chi khác luôn 0);
`settled=0` → margin `NaN%`.
