# MultiPOS — Quản trị Bán hàng & Thi công Đa ngành

Hệ thống POS đa ngành (nhôm kính/tấm đo m², vật tư, combo, dịch vụ), quản lý kho,
công nợ, công trình thi công 4 phase, HRM chấm công–lương, sổ quỹ, báo cáo VAT —
chuẩn KiotViet. PWA offline-first (Dexie) + Supabase (Postgres) làm source of truth khi online.

## Stack

- Next.js 15 + React 19 + TypeScript + Tailwind 4, PWA (`public/sw.js`, `app/offline`)
- Client state: `lib/store.tsx` • Local DB: Dexie (`lib/db.ts`) • Server: Supabase
  (`lib/supabase/`, `supabase/migrations/0001–0038`)
- Phân quyền: `admin / manager / cashier / worker` (Supabase Auth + RLS + RPC
  `SECURITY DEFINER`; API `app/api/admin/*` chặn leo quyền)

## Chạy local

1. `npm install`
2. Copy `.env.example` → `.env.local`, điền `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client) và `SUPABASE_SERVICE_ROLE_KEY` (chỉ server,
   cho `scripts/seed-users.mjs` + API admin). Không có env vẫn chạy local-only (Dexie).
3. `npm run dev` → mở `http://localhost:3000`

Lệnh khác: `npm run build` (lint chặn build — 0 errors), `npm run lint`, `npm start`.

## Quy ước tiền/kho (bắt buộc đọc trước khi sửa POS)

- Server tính lại mọi thứ trong RPC (`pos_checkout` → `checkout_order`): tổng dòng,
  VAT% trên (tiền hàng − CK bill, không gồm ship), ship, làm tròn tiền mặt theo
  `settings.cash_rounding`, trừ kho GROUP BY, chặn nợ vô chủ (rollback toàn bộ).
- Mọi nấc tiền integer (VND không hào), `orders.subtotal` là thuần tiền hàng (không gồm
  ship). Client gửi TIỀN KHÁCH ĐƯA (không kẹp ở payable) để server chia paid/change/debt.
- Toán tiền local dồn về `lib/pricing.ts` (single source, cấm implement riêng ở POS/store):
  test unit `npm test`, fuzz parity local-vs-server `npm run test:parity`.
- Client chỉ gửi *ý định*; số hiển thị sau checkout lấy từ response server.
  Hủy/trả/thu nợ online cũng đi RPC (`cancel_order`, `return_order_items`, `collect_debt`);
  đơn đã lên server mà offline thì **chặn** để khỏi lệch truth.
- Chính sách trả hàng hoàn kho (0025): hàng `goods` hoàn đủ SL, `combo` hoàn linh kiện
  con theo BOM (cap theo SL đã bán); hàng `area` đã cắt + `service` không nhập lại.
- P2.3: có thể tải/khôi phục sao lưu local trong Cài đặt; BOM combo được kéo từ
  `combo_items`; hạn mức nợ khách hàng được chặn nguyên tử ở server (hạn mức 0 = không giới hạn).
- Xem `supabase/migrations/0023_vat_support.sql`, `0024_cancel_reverse.sql`,
  `0025_return_restock.sql`.

## Migrations & verify

- Full bộ: `SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-migrations.mjs`
  (lưu ý: `0017_payroll.sql` là file lịch sử, không rerun — xem header file).
- Apply 1 file: `SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-one.mjs 0024_cancel_reverse.sql`
- Verify e2e (đọc `.env.local`, dọn dữ liệu test sau chạy):
  `node scripts/verify-pos-checkout.mjs` (catalog, tiền thừa, trừ kho, hàng m²),
  `node scripts/verify-vat-checkout.mjs` (VAT 8/10%, ship, CK bill),
  `node scripts/verify-customer-sync.mjs` (sync KH, guard nợ),
  `node scripts/verify-cancel-return-debt.mjs [user] [pass]` (hủy/trả/thu nợ — cần tài khoản
  `authenticated`, mặc định `cashier@multipos.local` từ `scripts/seed-users.mjs`).

## Cấu trúc

- `app/` — 1 trang SPA chuyển màn hình (`page.tsx`), API admin, trang offline
- `components/pos|orders|products|inventory|customers|suppliers|projects|hrm|cashbook|reports|settings/` —
  11 phân hệ; `components/common/` — bảng/sắp xếp/phân trang dùng chung
- `lib/` — `types.ts`, `hrm.ts` (single source HRM), `db.ts`, `store.tsx`, `excel.ts`,
  `vietqr.ts`, `format.ts`, `error-vi.ts`
- `scripts/` — seed, verify, sửa chữa kho (`repair-stock.mjs`, `restore-stock.mjs`)

## Hướng dẫn sử dụng

Hướng dẫn vận hành cho nhân viên và quản trị viên nằm tại
[`docs/15-huong-dan-van-hanh.md`](docs/15-huong-dan-van-hanh.md). Tài liệu gồm:

- đăng nhập, mở ca và thao tác bán hàng;
- tạo hàng hóa, khách hàng, nhà cung cấp;
- nhập kho, công nợ, công trình, nhân sự, sổ quỹ và báo cáo;
- quy tắc khi mất mạng và kiểm tra hàng đợi đồng bộ;
- quy trình sao lưu, bàn giao và xử lý lỗi thường gặp.
