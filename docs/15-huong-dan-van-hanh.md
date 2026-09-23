# Hướng Dẫn Vận Hành Hệ Thống MultiPOS

Tài liệu hướng dẫn quy trình vận hành dành cho Nhân viên (Cashier/Worker) và Quản trị viên (Admin/Manager) trên hệ thống MultiPOS.

---

## 1. Đăng nhập, Mở ca & Thao tác Bán hàng (POS)

### 1.1 Đăng nhập & Chọn Ca
- Đăng nhập bằng mã nhân viên và mật khẩu/PIN.
- Khi đăng nhập thành công, hệ thống chuyển thẳng đến màn hình **Bán hàng (POS)**.
- Mở ca làm việc (Shift F12) để khai báo số tiền tiền mặt đầu ca trong két.

### 1.2 Thao tác Bán hàng tại POS
- **Tìm sản phẩm**: Sử dụng thanh tìm kiếm (hoặc quét mã vạch).
- **Hàng đo $m^2$ (Nhôm kính)**: Nhấn **F3** để nhập chiều rộng, chiều dài, số lượng, chi phí mài cạnh, khoan lỗ, cắt góc.
- **Hàng Combo / Vật tư**: Tự động tính theo đơn giá định mức BOM.
- **Thanh toán & Làm tròn**:
  - Hỗ trợ thanh toán: Tiền mặt, Chuyển khoản (VietQR động), Thẻ, Ghi nợ.
  - Cấu hình tiền mặt tự động làm tròn theo quy tắc cửa hàng (`cash_rounding`).
  - Gửi số tiền khách đưa, hệ thống tự tính tiền thừa (change) hoặc dồn vào công nợ (debt).

---

## 2. Quản lý Danh mục (Hàng hóa, Khách hàng, Nhà cung cấp)

- **Sản phẩm (Products)**: Thêm/Sửa sản phẩm m², dịch vụ, linh kiện. Cấu hình định mức BOM cho hàng combo.
- **Khách hàng (Customers)**: Quản lý thông tin, kiểm soát hạn mức công nợ (`debt_limit`). Hệ thống sẽ tự động chặn nguyên tử ở server nếu khách hàng vượt hạn mức nợ cho phép.
- **Nhà cung cấp (Suppliers)**: Lưu trữ lịch sử nhập hàng và theo dõi nợ phải trả NCC.

---

## 3. Nhập kho, Công trình, Nhân sự, Sổ quỹ & Báo cáo

- **Kho hàng (Inventory)**: Thực hiện phiếu nhập kho, xuất kho, kiểm kho. Lịch sử biến động kho được lưu vết chính xác theo từng lô/sản phẩm.
- **Thi công Công trình (Projects)**: Quản lý theo 3-4 giai đoạn (Báo giá dự toán -> Thi công -> Nghiệm thu & P&L).
- **Nhân sự (HRM)**:
  - Chấm công ngày / tính lương giờ & lương tháng.
  - Đăng ký tạm ứng lương (tự động hạch toán phiếu chi sổ quỹ).
  - Duyệt bảng lương & khóa sổ tháng.
- **Sổ quỹ (Cashbook)**: Quản lý Thu / Chi. Tự động sinh phiếu thu/chi khi bán hàng, thu nợ, hoặc chi lương.
- **Báo cáo (Reports)**: Theo dõi doanh thu, lợi nhuận thực tế, báo cáo thuế VAT (8%, 10%), dư nợ và top mặt hàng bán chạy.

---

## 4. Quy tắc khi Mất mạng (Offline-first) & Hàng đợi Đồng bộ

- **Chế độ Offline**:
  - Khi mất kết nối internet, ứng dụng tự động lưu đơn hàng, khách hàng, nhật ký vào cơ sở dữ liệu local (Dexie IndexedDB).
  - Mọi thao tác bán hàng local vẫn diễn ra bình thường.
- **Đồng bộ khi có mạng (Online Sync)**:
  - Hệ thống kiểm tra và đẩy hàng đợi giao dịch lên Supabase Cloud qua các hàm RPC an toàn.
  - Các giao dịch nhạy cảm (như hủy đơn, trả hàng hoàn tiền, thu nợ) yêu cầu xác nhận online để đảm bảo tính toàn vẹn cơ sở dữ liệu.

---

## 5. Quy trình Sao lưu, Bàn giao & Xử lý lỗi

- **Sao lưu & Khôi phục**: Vào menu **Cài đặt (Settings)** -> Tải bản sao lưu dữ liệu local (.json) để lưu trữ định kỳ.
- **Bàn giao ca**: Kiểm tra tổng tiền mặt cuối ca tại modal Shift (F12) và kết ca.
- **Xử lý lỗi thường gặp**:
  - Mất kết nối Supabase: Kiểm tra lại cấu hình `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` và `ANON_KEY`).
  - Lệch dữ liệu kho/công nợ: Quản trị viên chạy kịch bản verify hoặc script sửa kho `node scripts/repair-stock.mjs`.
