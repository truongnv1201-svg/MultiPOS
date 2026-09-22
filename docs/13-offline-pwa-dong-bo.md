# 13 — Offline / PWA / đồng bộ

## 1. Lớp local (`lib/db.ts`)
Dexie `MultiPOSDB_v212` (v1→v5): products, customers, suppliers, orders, projects, cashbook,
shifts, purchaseOrders, **`pendingOrders`** (queue offline), employees, attendanceDays.
Rỗng thì seed `INITIAL_*`. Mã chứng từ: `HD/TH/NH/CT/PQ/PT/PC-YYMMDD-SEQ`.

## 2. Mạng (`lib/store/network.tsx` + header)
`isOnline` mặc định true, nghe sự kiện trình duyệt; nút header giả lập mất mạng;
badge số đơn chờ (giữ chỗ cố định, không xô nút) bấm để sync.

## 3. Bán offline (`checkoutActiveOrder`)
Tính local đủ (trừ kho theo BOM/waste, chặn lố kho, cộng nợ, phiếu thu, cộng stats ca),
lưu Dexie, push `pendingQueue`, đơn `is_offline` + giữ `tendered_amount` để replay.
**Replay** (`syncPendingOrders`, cần online): dựng lại `pos_checkout` từng đơn
(VAT riêng nếu đơn mới, đơn cũ gộp VAT dư vào ship; tương thích server cũ qua PGRST202);
xong xóa queue + kéo tồn server; fail giữ lại + alert lý do. Local-only: clear queue.

## 4. Chặn lệch truth
Đơn/KH đã lên server mà offline → **chặn** hủy/trả/thu nợ (`resolveServerOrderId` ưu tiên
`server_id`, fallback tra `order_code`). Đơn offline hủy/trả → gỡ khỏi queue khỏi replay.
Thu/đồng bộ nợ: server là truth (kéo lô 100 uuid, ghi đè local).
Chấm công ghi local `synced=false` rồi sync sau; nhân sự/ứng/lương bắt online.

## 5. PWA
`PwaRegister` (chỉ production đăng ký `/sw.js` `multipos-v212-1`): precache `/offline`,
điều hướng network-first rớt → `/offline`, static cache-first, chỉ GET same-origin.
Trang `/offline`: báo mất mạng + nút tải lại POS.
