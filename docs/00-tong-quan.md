# 00 — Tổng quan hệ thống MultiPOS

> Nguồn: đặc tả trích từ code hiện tại (Next.js 15 + Supabase). Mỗi phân hệ chi tiết ở file `01`–`14`.

## 1. Hệ thống là gì

MultiPOS — quản trị bán hàng & thi công đa ngành (nhôm kính đo m², vật tư, combo trọn bộ,
dịch vụ), quản lý kho (giá vốn bình quân MAC), công nợ KH/NCC, công trình 4 phase, HRM
chấm công–lương, sổ quỹ, báo cáo VAT — chuẩn KiotViet. PWA offline-first.

## 2. Stack

| Lớp | Công nghệ |
|---|---|
| App | Next.js 15 + React 19 + TypeScript + Tailwind 4, PWA (`public/sw.js`, `app/offline`) |
| State client | `lib/store.tsx` + slice `lib/store/*` |
| DB local | Dexie IndexedDB (`lib/db.ts`, DB `MultiPOSDB_v213`) |
| Server | Supabase Postgres (`lib/supabase/`, `supabase/migrations/0001–0037`) |
| Auth | Supabase Auth + RLS + RPC `SECURITY DEFINER`; API `app/api/admin/*` |

## 3. Quy ước bắt buộc (đọc trước khi sửa)

**Tiền (đồng bộ local ↔ server từng đồng):**
- Mọi công thức tiền local dồn về `lib/pricing.ts` (single source, cấm implement riêng):
  - Dòng đo đạc: `m2 = Dài×Rộng×SL`, `chu vi = 2×(D+R)×SL`,
    `phí = chu vi×đơn giá mài + phụ phí tay (+ legacy lỗ/góc)`,
    `subtotal dòng = m2×đơn giá + phí − CK dòng`.
  - Giỏ: `ship%` tính trên (tiền hàng − CK bill); `VAT%` tính trên (tiền hàng − CK bill,
    **không gồm ship**); làm tròn tiền mặt **chỉ khi method=cash**
    (`rounding = rawPayable % mệnh giá server`, mặc định 500đ);
    `payable = tiền hàng + ship + VAT − CK bill − rounding`.
  - `resolvePaidAmount`: debt→0; cash→min(payable, tendered); transfer/card bỏ trống = trả đủ.
- Server tính lại mọi thứ trong RPC (`pos_checkout` → `checkout_order`): tổng dòng, VAT, ship,
  rounding, trừ kho GROUP BY, chặn nợ vô chủ (rollback toàn bộ).
- Client gửi **TIỀN KHÁCH ĐƯA** (không kẹp ở payable); số hiển thị sau checkout lấy từ response server.
- Mọi nấc tiền integer (VND không hào); `orders.subtotal` là thuần tiền hàng (không gồm ship).

**Kho:** hàng `goods` trừ đủ SL; `area` trừ theo `m2×(1+hao hụt%)`; `combo` trừ linh kiện con
theo BOM (không trừ SP cha); `service` không trừ. Bán lố kho bị chặn cả online lẫn offline.
Trả hàng hoàn kho: `goods` đủ, `combo` hoàn linh kiện (cap theo SL đã bán),
`area` đã cắt + `service` không nhập lại.

**Nợ:** `current_debt >= 0` mọi nơi; server là truth công nợ; đơn đã lên server mà offline
thì **chặn** hủy/trả/thu nợ để khỏi lệch.

**Ca:** bán/nhập/thu chi yêu cầu ca `open` **đứng tên người đang login** (trừ Admin/Quản lý
được override); kết ca ghi đè? Không — giữ tên người mở để truy vết.

## 4. Vai trò

`admin` (Quản trị) / `manager` (Quản lý) / `cashier` (Thu ngân) / `worker` (Thợ).
Login bằng mã NV (`NV0001` → `nv0001@nv.local`) hoặc email cũ; cổng bắt buộc khi có Supabase;
login xong vào POS. Chi tiết xem `12-auth-phan-quyen.md`.

## 5. Lệnh vận hành

```powershell
npm run dev      # chạy local (cần .env.local khi dùng Supabase)
npm run lint     # 0 error mới được build
npm test         # unit pricing (node --test)
npm run build
node scripts/verify-pos-checkout.mjs
node scripts/verify-vat-checkout.mjs
node scripts/verify-pricing-parity.mjs 25
node scripts/verify-cancel-return-debt.mjs cashier@multipos.local <pass>
node scripts/verify-customer-sync.mjs
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-one.mjs <file.sql>
```

## 6. Bản đồ file đặc tả

| File | Phần |
|---|---|
| `01-pos-ban-hang.md` | Bán hàng POS |
| `02-hoa-don-huy-tra-no.md` | Hóa đơn, hủy/trả/thu nợ |
| `03-hang-hoa.md` | Danh mục hàng hóa |
| `04-kho-nhap.md` | Kho + nhập (MAC) |
| `05-khach-hang-cong-no.md` | KH + công nợ phải thu |
| `06-nha-cung-cap.md` | NCC + công nợ phải trả |
| `07-cong-trinh.md` | Công trình 4 phase + P&L |
| `08-hrm.md` | Nhân sự, chấm công, lương |
| `09-so-quy-ca.md` | Sổ quỹ + ca làm việc |
| `10-bao-cao.md` | Báo cáo + VAT |
| `11-cai-dat.md` | Cài đặt hệ thống |
| `12-auth-phan-quyen.md` | Đăng nhập + phân quyền |
| `13-offline-pwa-dong-bo.md` | Offline/PWA/đồng bộ |
| `14-database-rpc.md` | Schema + RPC + scripts |
| `15-huong-dan-van-hanh.md` | Hướng dẫn sử dụng và vận hành |
