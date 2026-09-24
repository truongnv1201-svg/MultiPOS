# Runbook kỹ thuật MultiPOS (P6)

Dành cho quản trị viên/đơn vị triển khai. Hướng dẫn vận hành cho nhân viên ở
`docs/15-huong-dan-van-hanh.md`.

## 1. Dựng mới cửa hàng / project trắng

```bash
# 1) Tạo project Supabase (region gần nhất, plan free đủ verify)
# 2) Migrate full chuỗi (0017 tự SKIP — file lịch sử):
SUPABASE_ACCESS_TOKEN=sbp_... [SUPABASE_PROJECT_REF=<ref>] node scripts/apply-migrations.mjs
# 3) Seed tài khoản + catalog mẫu (.env.local trỏ sang project mới):
node scripts/seed-users.mjs        # admin@multipos.local / cashier@multipos.local (ĐỔI MK NGAY)
node scripts/seed-catalog.mjs      # idempotent (upsert theo sku), KHÔNG chạy lên DB đang bán
# 4) Verify trước khi bàn giao:
npm run test:live                   # pos/vat/customer/debt/return — tự dọn sau chạy
node scripts/verify-cancel-return-debt.mjs NV0001 <matkhau>
```

Đã chứng minh: 48/48 migrations OK trên project trắng + full suite xanh.

## 2. CI (`/.github/workflows/ci.yml`)

| Job | Chạy khi | Cần secrets |
|---|---|---|
| `static` | mọi push/PR | không |
| `parity` | sau static | không bắt buộc (`SUPABASE_ACCESS_TOKEN` để fuzz ghi+dọn) |
| `live` | đủ 3 secrets | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN` |
| `e2e` | đủ URL+ANON | trên + `E2E_LOGIN_ID`, `E2E_LOGIN_PASSWORD` (tài khoản seed) |

E2E live tự dọn: checkout rồi hủy qua UI; HRM chỉ điều hướng đọc.

## 3. Sự cố: kẹt hàng đợi offline

- Dấu hiệu: badge vàng `#pending-queue-badge` hiện số đơn > 0 sau khi đã online.
- Bấm badge (gọi `syncPendingOrders`) hoặc nút Làm mới `#header-refresh-btn`.
- Replay an toàn: mỗi op mang `client_ref` dedupe ở server nên sync lặp không nhân đơn
  (đã verify: "trả lặp không cộng kho", "hủy sau trả bị chặn").
- Đơn đã lên server mà máy offline: app **chặn** sửa/hủy offline để khỏi lệch truth —
  phải online mới xử lý tiếp.

## 4. Sự cố: lệch tồn kho

- Đối chiếu `stock_movements.reference_code` với đơn gốc trước khi sửa tay.
- Sửa chữa: `node scripts/repair-stock.mjs`, hoàn tác: `node scripts/restore-stock.mjs`.
- Chính sách hoàn kho (0025): `goods` hoàn đủ SL; `combo` hoàn linh kiện con theo BOM;
  `area` đã cắt + `service` không nhập lại.

## 5. Sự cố: đơn sai tiền / sai khách

- Đơn mới (`completed`): Hủy hóa đơn & Hoàn quỹ trong Đơn hàng (hoàn kho + hoàn quỹ tự động).
- Đã giao 1 phần: Trả hàng & Hoàn tiền, chọn đúng dòng + SL (tiền hoàn phân bổ theo tỉ trọng dòng).
- Mọi thao tác qua RPC server (`cancel_order`, `return_order_items`) — client chỉ gửi ý định.

## 6. Tiền / VAT (quy ước khóa)

- Server tính lại mọi thứ; VAT% trên (tiền hàng − CK bill, không gồm ship).
- **Làm tròn tiền mặt là floor về mệnh giá** (`total = raw − raw % denom`,
  denom đọc từ `settings.cash_rounding`, mặc định 500) — client (`lib/pricing.ts`)
  và script verify dùng cùng công thức nên parity local-vs-server luôn khớp.
- VND không hào, mọi nấc tiền integer.

## 7. Sao lưu / khôi phục

- Trong Cài đặt: tải + khôi phục sao lưu local (Dexie). Khôi phục chỉ ảnh hưởng máy đó;
  số liệu server là truth khi online — sau khôi phục bấm Làm mới để kéo lại.

## 8. Ma trận test

| Lệnh | Phủ | Cần live |
|---|---|---|
| `npm test` | unit pricing (21) + HRM (16) | không |
| `npm run test:parity` | fuzz local-vs-server 25 cases | token để ghi+dọn |
| `npm run test:live` | RPC pos/vat/customer/debt/return | có |
| `npm run test:e2e` | UI login/POS/checkout→hủy/offline/HRM | có + seed |
