# 14 — Database, RPC & scripts

## 1. Migrations (`supabase/migrations/`, 33 file)
0001 settings + hàm sinh mã · 0002 master + vốn BQ · 0003 orders/checkout ·
0004 quỹ/nợ/trả/hủy · 0005 kho/mua/dự án/ca · 0006 RLS+RBAC · 0007 `pos_checkout` +
catalog anon + seed 11 SKU · 0008 profiles · 0009 sync KH + guard nợ vô chủ ·
0010 settings/mài · 0011 server hóa ca · 0012 tách admin/manager · 0013 manager quản NV ·
0014–0019 HRM (chấm công, hồ sơ, phép, lương, rebuild) · 0020 link account ·
0021 drop nghỉ phép · 0022 tạm ứng · 0023 VAT riêng · 0024 hủy hoàn kho/đảo nợ ·
0025 trả hoàn kho có cap · 0026 chống lặp hủy/trả · 0027 parity tiền · 0028 hardening P0 ·
0029 fix PGRST203 · 0030 xóa overload lạ · 0031 vá RLS nợ · 0032 trả tách nhánh cọc ·
0033 index đường nóng.

## 2. Bảng chính
`branches · profiles (id→auth.users, full_name, role, branch_id) ·
products (sku/barcode unique, loại goods/area/combo/service, lẻ/thợ/nhập/vốn BQ, tồn≥0,
min, waste, mài) · product_variants · combo_items · customers (code unique, nhóm, nợ, hạn mức) ·
suppliers · orders (HD, KH, status pending/deposit_order/completed/cancelled/returned,
tiền hàng/CK/ship/rounding/tổng/đã thu/nợ, VAT, thu ngân) ·
order_items (sku, loại, SL, đơn giá, CK, phí gia công, subtotal, dimension_details
{m2, md, mài}, waste, material_consumed) · cashbook_entries (PT/PC, thu/chi, cash/bank,
sales/deposit/debt_collection/…/other) · stock_movements · purchase_orders (NH) ·
projects (CT, phase 1–4) + materials/attendance · shifts (chủ ca, đầu ca/lý thuyết/đếm/chênh,
doanh số cash/bank/cọc/chi) · settings · grinding_services · employees · attendance_days ·
payroll_* · salary_advances`.

## 3. RPC (`SECURITY DEFINER`)
- `pos_checkout(...)`: 1 call POS — sinh HD, insert dòng (area tính m²×waste server),
  gọi `checkout_order`, guard nợ vô chủ, cọc → `deposit_order`. Trả full số liệu đơn.
- `checkout_order(...)`: tính lại dòng/tổng/VAT/rounding, chia paid/change/debt,
  trừ kho GROUP BY (bỏ service/combo cha), cộng nợ, ghi sổ quỹ.
- `cancel_order(id)`: hoàn kho (+BOM), đảo nợ clamp ≥0, hoàn từng quỹ, `cancelled`, chống lặp.
- `return_order_items(id, refund, restock[{sku,qty}])`: trừ nợ tối đa (cap theo nợ đơn +
  tách nhánh cọc), dư hoàn tiền mặt; hoàn kho cap SL bán, skip area/service;
  trả `{debt_cut, cash_refund, restocked, skipped}`.
- `collect_debt(...)`: `take=min(tiền, nợ)`, trừ nợ, phiếu thu, trả `{collected}`.
- `sync_customer(...)`: upsert theo phone→code (mới lấy nợ local, cũ giữ nợ server).
- `open_shift` (chặn chồng ca) / `close_shift` (chủ ca/manager, tính chênh, bất biến khi đóng).

## 4. Scripts (`scripts/`)
Apply: `apply-migrations`, `apply-one` (hỗ trợ `SUPABASE_PROJECT_REF`).
Seed/soi: `seed-users`, `check-profiles`, `debug-login`, `inspect-orders`, `verify-db`,
`verify-service`, `final-check`. Verify: `verify-pos-checkout`, `verify-vat-checkout`,
`verify-pricing-parity` (fuzz local↔server), `verify-cancel-return-debt`,
`verify-customer-sync`, `verify-debt-sync`, `verify-return-restock`.
Kho: `repair-stock`, `restore-stock`, `reset-commercial`, `cleanup-smoke`.
Test: `pricing.test.mjs` (`npm test`).
