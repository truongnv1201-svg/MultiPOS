# 09 — Sổ quỹ & ca (`components/cashbook/CashbookView.tsx`, `ShiftModalF12.tsx`)

## 1. Sổ quỹ kép (cash + bank)
Bất biến: doanh thu chỉ ghi 1 lần lúc checkout; sổ quỹ phản ánh dòng tiền.
Entity `CashbookEntry`: `id · code (PT/PC-YYMMDD-XXXX) · type (receipt|expense) ·
fund (cash|bank) · category (sales|deposit|debt_collection|supplier_payment|labor|
material|advance|other) · amount · reference_order_code? · partner_name? · note* · created_at`.
Màn hình: 3 thẻ tồn (tổng = két + ngân hàng; số dư đầu kỳ đang cứng 2tr + 15tr),
lọc mã/đối tác/note + quỹ + thu/chi + danh mục + ngày, dải thu-chi-ròng, sort, phân trang,
Excel/In (không nhập Excel).

## 2. Phiếu sinh tự động (không qua màn này)
Bán → thu `sales` (cọc → `deposit`); hủy → chi `other` hoàn từng quỹ gốc;
trả hàng → chi hoàn phần dôi; nhập kho → chi `material` (bank);
thu nợ KH → thu `debt_collection`; trả NCC → chi `material`; tạm ứng → chi `advance`;
chi lương → chi `labor`.

## 3. Phiếu tay (`addCashbookEntry`)
Cần login + ca mở; `amount>0`, note bắt buộc. Riêng chi `advance` rẽ sang tạm ứng lương:
bắt buộc Admin/Quản lý + NV active + online + tháng chưa chốt → ghi `salary_advances`
server + phiếu chi, tự khấu trừ lương tháng.

## 4. Ca làm việc (F12)
Mở ca (tiền đầu két, đứng tên người login; server chặn chồng ca) → bán/nhập/thu chi cộng dồn
(`cash_sales`, `transfer_sales`, `deposit_collected`, `cash_payouts`, `expected_cash`,
`order_count`) → kết ca kiểm đếm (`diff = đếm − lý thuyết`), chặn khi offline/còn đơn
chưa sync/chưa login. **Gắn người:** chỉ chủ ca hoặc Admin/Quản lý được kết ca hộ;
bán vào ca đứng tên người khác bị chặn; kết ca giữ tên người mở để truy vết.
Seed DB mới để ca ĐÓNG (người dùng tự mở ca đầu).

## 5. Phân quyền & biên
Phiếu thường: login + ca mở. Tạm ứng/nhập kho/trả NCC: Admin/Quản lý.
Số dư đầu kỳ cứng sẽ lệch khi đa chi nhánh — cần đặc tả số dư theo ca/quỹ thật khi mở rộng.
