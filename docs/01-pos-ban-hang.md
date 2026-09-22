# 01 — Bán hàng POS (`components/pos/POSScreen.tsx`)

## 1. Mục đích
Màn hình bán chính: tìm hàng → lên giỏ (tối đa 5 tab hóa đơn) → tính tiền (CK/ship/VAT/
làm tròn) → thu tiền → in hóa đơn. Có luồng **Nhập hàng** riêng (Admin/Quản lý) chung màn hình.

## 2. Loại hàng (`product_type`)
| Loại | Giá theo | Trừ kho khi bán |
|---|---|---|
| `goods` | SL × đơn giá | Đủ SL |
| `area` (đo m², modal F3) | m² thực × đơn giá + phí gia công | `m2 × (1 + hao hụt%)` |
| `combo` | SL bộ × đơn giá | Linh kiện con theo BOM (`child.qty × SL bộ`), preview BOM đọc thật từ `combo_items` |
| `service` | SL × đơn giá | Không trừ |

Bảng giá: `retail` (Giá lẻ) / `trade` (Giá thợ), đổi qua nút hoặc tự theo nhóm KH.

## 3. Giỏ + tính tiền (`lib/pricing.ts`)
- Thêm hàng: gộp dòng trùng SKU (trừ `area` luôn dòng mới); sửa SL/đơn giá tính lại qua
  `recomputeOrderItem`.
- CK bill: nhập VND hoặc % (`%` = `round(subtotal×%/100)`).
- Ship: VND cố định hoặc % trên (tiền hàng − CK bill).
- VAT `0/8/10%` trên (tiền hàng − CK bill), không gồm ship.
- Làm tròn chỉ khi `payment_method=cash`, theo mệnh giá server (`settings.cash_rounding`, mặc định 500đ).
- Ô "tiền khách đưa" (F9): tiền mặt **bắt buộc nhập**; transfer/card bỏ trống = trả đủ;
  `debt` = ghi nợ toàn bộ. Thiếu mà chưa chọn KH (khách lẻ) → chặn **nợ vô chủ**.

## 4. Thanh toán (F10) / Nhận cọc (Ctrl+F9)
Điều kiện: đã login (khi có Supabase), ca `open` **đứng tên mình** (trừ Admin/Quản lý).
- Online: 1 call `pos_checkout` (gửi tiền khách đưa + `p_vat_percent`); số liệu hiển thị lấy từ
  response server; fallback gộp VAT vào ship nếu server chưa migrate (PGRST202).
- Offline/chưa cấu hình: tính local + trừ kho local + vào hàng đợi `pendingQueue`
  (giữ `tendered_amount` để replay đúng), đơn đánh dấu `is_offline`.
- Đơn cọc: bắt buộc có hồ sơ KH + tiền cọc > 0; server chuyển `deposit_order` + sổ quỹ sang `deposit`.
- Xong: mở `ReceiptModal` (VietQR động theo số tiền, in A4/A5/K80).

## 5. Phím tắt
F1 tìm/quét · F2 đổi chế độ Thẻ/Nhanh · F3 quy cách m² · F4 khách (F4 thêm nhanh KH) ·
F6 ship · F7 chuyển tab · F8 CK · F9 tiền khách đưa · Ctrl+F9 cọc · F10 thanh toán · F12 ca.

## 6. Validate & biên
- Giỏ trống, tiền mặt chưa nhập, nợ vô chủ, tồn không đủ (kể cả offline), ca đóng/sai chủ → chặn + báo rõ.
- Replay thất bại (hết kho/nợ vô chủ) → giữ đơn trong queue + alert lý do, không mất đơn.
