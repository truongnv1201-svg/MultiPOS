# 10 — Báo cáo (`components/reports/ReportsView.tsx`)

## 1. Mục đích
Báo cáo quản trị chỉ đọc: 5 KPI + bảng VAT theo tháng (đối chiếu sổ quỹ) + biên lợi mặt hàng +
top nợ KH. Switch Hôm nay/Tuần/Tháng + Excel 4 sheet (Tổng hợp/Biên lợi/Công nợ/VAT);
In chỉ in bảng nợ.

## 2. Công thức
- `doanh thu = Σ total_amount`, `thực thu = Σ paid_amount` (đơn `completed` + `deposit_order`;
  hủy/trả loại). `còn nợ = Σ current_debt`. Tồn kho = Σ(tồn × vốn, bỏ service).
- `lãi gộp = Σ(total − Σ(qty × vốn))` (chỉ completed; mất SP fallback `giá bán×0.7`).
- Bảng margin (6 SP đầu): `margin = lẻ − vốn`, `% = margin/lẻ`.
- Bảng nợ: `tỉ lệ = nợ/hạn mức` (hạn mức 0 → 0%), mặc định sort nợ giảm dần.
- VAT theo tháng (`created_at` YYYY-MM): số đơn, doanh thu, tổng VAT, tách 8%/10%,
  sổ quỹ (thu `sales|deposit` cùng tháng); `chênh lệch = doanh thu − sổ quỹ`
  (≈ bán nợ + cọc chưa quyết toán). Đơn cũ chưa có `vat_amount` tính 0 + footnote.

## 3. Phân quyền, nguồn & biên
Đọc store in-memory (đã sync qua catalog/KH/replay); công thức mirror server 0023.
Chia 0 được chặn (lẻ 0, doanh thu 0). Rỗng → "Chưa có đơn hiệu lực".

## 4. Ghi chú đã biết
- `timeRange` (Hôm nay/Tuần/Tháng) hiện **chưa dùng lọc** — mọi KPI tính all-time.
- Không guard trong view: thu ngân cũng xem được giá vốn/lợi nhuận — cần chặn khi rảnh.
- `vatByRate` chứa mức lạ ngoài 8/10 nhưng UI chỉ hiện 2 cột.
