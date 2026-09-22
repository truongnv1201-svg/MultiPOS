# 02 — Hóa đơn, hủy/trả/thu nợ (`components/orders/OrdersView.tsx`)

## 1. Quản lý hóa đơn
Bảng lọc (mã/ tên KH / SĐT, trạng thái, hình thức TT, ngày qua `DateFilter`), sắp xếp header,
phân trang 25 dòng, dải tổng (doanh số / thực thu / còn nợ), Excel/In, xem chi tiết
(tiền hàng, CK, ship, VAT, rounding, đã thu, còn nợ), in lại hóa đơn.
Đổi lọc/trang tự bỏ chọn đơn đang xem (khỏi bấm nhầm Hủy).

## 2. Trạng thái đơn
`pending` (chờ) · `deposit_order` (đã nhận cọc) · `completed` (hoàn tất) · `cancelled` (đã hủy) ·
`returned` (đã trả). Chỉ `completed`/`deposit_order` được trả; đã hủy/trả không xử lý lặp
(server 0026 RAISE cả khi gọi trực tiếp).

## 3. Hủy đơn (`cancel_order`)
- Điều kiện: đã login, ca mở; đơn server mà offline → **chặn**.
- Server: hoàn kho (thường theo m2×waste, combo hoàn linh kiện, bỏ service), đảo nợ KH
  (`max(0, nợ − nợ đơn)`), hoàn từng quỹ gốc bằng phiếu chi `PC`, status `cancelled`.
- Local mirror tương ứng + gỡ khỏi `pendingQueue` nếu đơn offline.

## 4. Trả hàng (`return_order_items`, modal chọn dòng + SL)
- Modal: tích chọn dòng, sửa SL (tối đa SL đã bán); tiền hoàn phân bổ theo tỉ trọng dòng,
  kẹp không vượt `total_amount`; `area/service` báo trước không nhập lại kho.
- Server: `debt_cut = min(hoàn, nợ KH, nợ của chính đơn)` (không gạt nợ đơn khác),
  dư hoàn tiền mặt; hoàn kho cap theo SL đã bán (trực tiếp + BOM combo);
  đơn cọc ghi note "Hoàn tiền cọc". Trả về `{debt_cut, cash_refund, restocked, skipped}`.
- Đơn server mà offline → chặn; đơn offline → gỡ khỏi queue sau trả.

## 5. Thu nợ KH (`collect_debt`)
Thu 1 phần/toàn phần bằng cash/transfer (ca mở, đã login). KH đã link server mà offline → chặn.
Server clamp theo nợ thật, trả `collected`; local mirror + sinh phiếu thu `debt_collection`,
tiền mặt cộng vào ca, rồi refresh nợ truth từ server. Nút **Đồng bộ nợ** kéo truth
(current_debt + debt_limit) theo lô 100 uuid.

## 6. Quy tắc chung
Mọi thao tác đổi tiền/nợ/kho online đi RPC rồi local mirror theo đúng số server trả về;
thất bại RPC giữ nguyên đơn/giỏ để thử lại, không ghi local nửa vời.
