# Hướng dẫn vận hành MultiPOS

Tài liệu này dành cho người bán hàng, quản lý cửa hàng và quản trị viên. MultiPOS là
ứng dụng bán hàng, kho và thi công; dữ liệu chung được lưu trên Supabase khi có mạng,
còn trình duyệt giữ một bản cache Dexie để tiếp tục làm việc trong thời gian mất mạng.

## 1. Bắt đầu mỗi ngày

1. Mở địa chỉ ứng dụng bằng Chrome hoặc Edge. Nếu dùng máy tính bảng/điện thoại, chọn
   **Thêm vào màn hình chính** để cài PWA.
2. Đăng nhập bằng mã nhân viên hoặc email.
3. Kiểm tra biểu tượng kết nối. Khi có mạng, chờ dữ liệu danh mục, đơn hàng và nhật ký
   kho tải xong.
4. Vào **Ca làm việc**, chọn **Mở ca** trước khi bán hàng, nhập kho hoặc thu/chi.
   Ca phải đứng tên đúng người đang đăng nhập.

Nếu không đăng nhập được, kiểm tra Caps Lock, mã nhân viên và kết nối mạng. Không dùng
service-role key trong trình duyệt.

## 2. Bán hàng

1. Vào **Bán hàng**, tìm hàng theo tên, SKU hoặc mã vạch rồi chọn số lượng.
2. Với hàng đo diện tích, mở dòng hàng và nhập dài, rộng, số lượng, phí gia công và
   hao hụt nếu có. Hệ thống tự tính m² và chu vi.
3. Chọn khách hàng nếu bán ghi nợ, nhận cọc hoặc cần theo dõi lịch sử.
4. Kiểm tra giảm giá, VAT, phí giao hàng và phương thức thanh toán.
5. Với tiền mặt, nhập đúng **Số tiền khách đưa**; không nhập trực tiếp tiền thừa.
6. Bấm thanh toán và kiểm tra hóa đơn/tiền thừa sau khi server xác nhận.

Giá trị cuối cùng của hóa đơn được server tính lại. Không sửa số tiền bằng công cụ
trình duyệt hoặc dựa vào con số hiển thị trước khi thanh toán.

## 3. Hàng hóa, khách hàng và nhà cung cấp

- **Hàng hóa**: tạo SKU ổn định, tên, loại hàng, đơn vị, giá bán và tồn tối thiểu.
  Hàng `goods` trừ theo số lượng; hàng diện tích trừ theo m²; combo trừ linh kiện
  theo BOM; dịch vụ không trừ kho.
- **Khách hàng**: nhập tên và số điện thoại để tránh tạo trùng. Chỉ ghi nợ khi đã
  chọn hồ sơ khách hàng.
- **Nhà cung cấp**: nhập mã, tên, điện thoại và thông tin công nợ nếu cần.

Khi mất mạng, thao tác tạo/sửa ba nhóm dữ liệu này vẫn được lưu vào hàng đợi cục bộ.
Khi mạng trở lại, ứng dụng tự đồng bộ theo thứ tự. Không xóa cache trình duyệt khi
đang chờ đồng bộ.

## 4. Kho và nhật ký thẻ kho

- Dùng **Nhập kho** để ghi nhận hàng nhập, giá nhập và nhà cung cấp.
- Kiểm tra **Tồn kho** sau khi nhập hoặc bán.
- Dùng **Nhật ký thẻ kho** để xem từng lần nhập, xuất, bán, trả hàng và tồn trước/sau.
- Không sửa trực tiếp tồn kho trong database. Nếu lệch tồn, khóa thao tác bán liên quan
  và nhờ quản trị viên kiểm tra RPC/nhật ký trước khi sửa.

Hủy/trả hàng chỉ thực hiện online đối với hóa đơn đã lên server. Hàng diện tích đã cắt
và dịch vụ không được tự động hoàn kho; combo hoàn lại linh kiện theo số lượng đã bán.

## 5. Công nợ, sổ quỹ và ca

- **Công nợ khách hàng**: xem lịch sử hóa đơn và thu nợ từ hồ sơ khách.
- **Công nợ nhà cung cấp**: ghi nhận nhập hàng và các khoản thanh toán phải trả.
- **Sổ quỹ**: ghi phiếu thu/chi có nội dung rõ ràng, đúng ca và đúng người thực hiện.
- **Đóng ca**: hoàn tất hoặc đồng bộ mọi đơn offline trước khi đóng ca. Sau khi khóa,
  kiểm tra biên bản và số tiền thực tế.

Không dùng tài khoản thu ngân để vào Cài đặt, quản lý nhân sự hoặc thay đổi quyền.

## 6. Công trình, nhân sự và báo cáo

- Tạo công trình, thêm vật tư/nhân công, ghi nhận tạm ứng và theo dõi từng giai đoạn.
- Trong **Nhân sự**, quản lý hồ sơ, chấm công, tạm ứng và bảng lương theo tháng.
- Trong **Báo cáo**, lọc đúng khoảng thời gian trước khi xuất Excel hoặc in.
- Định kỳ đối chiếu doanh thu, tồn kho, công nợ và sổ quỹ; không chỉ dựa vào một báo
  cáo duy nhất.

## 7. Quy trình khi mất mạng

1. Tiếp tục dùng POS cho các nghiệp vụ được phép offline.
2. Không hủy/trả/thu nợ đối với hóa đơn đã đồng bộ lên server.
3. Không xóa dữ liệu trang web, không đổi trình duyệt và không dùng chế độ ẩn danh.
4. Khi mạng trở lại, giữ ứng dụng mở và chờ đồng bộ. Có thể chuyển màn hình hoặc đưa
   cửa sổ về trước để kích hoạt lần đồng bộ tiếp theo.
5. Kiểm tra dữ liệu ở máy thứ hai sau khi biểu tượng mạng ổn định.

Nếu hàng đợi lỗi do trùng SKU/mã hoặc thiếu quyền, sửa dữ liệu theo thông báo rồi tạo
thao tác mới khi online. Không cố lặp lại vô hạn cùng một dữ liệu lỗi.

## 8. Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Không thấy dữ liệu máy khác | Kiểm tra mạng, đăng nhập lại, chờ refresh; không xóa cache khi còn thao tác chờ |
| Không tạo được sản phẩm | Kiểm tra SKU đã tồn tại, quyền tài khoản và trạng thái mạng |
| Không thanh toán được | Kiểm tra ca đang mở, tồn kho, khách ghi nợ và số tiền khách đưa |
| Nhật ký kho chưa cập nhật | Chờ đồng bộ, refresh trang; đối chiếu hóa đơn và trạng thái server |
| Không vào được phân hệ | Kiểm tra vai trò; cashier/worker bị giới hạn theo quyền |
| Danh sách không cuộn | Tải lại trang một lần; nếu vẫn lỗi, ghi lại trình duyệt, màn hình và thời điểm |

Khi báo lỗi, gửi kèm mã hóa đơn, mã nhân viên, thời gian, ảnh chụp và thao tác ngay
trước khi lỗi. Không gửi access token, service-role key hoặc mật khẩu.

## 9. Vận hành và bảo trì

### Triển khai

Thiết lập `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY` trên môi trường
chạy app. `SUPABASE_SERVICE_ROLE_KEY` chỉ được dùng ở server/API hoặc script quản trị,
không đưa vào `.env.local` của máy người dùng và không commit lên Git.

### Kiểm tra trước khi bàn giao

```powershell
npm install
npm run lint
npm test
npm run build
```

Nếu cần kiểm tra sâu với Supabase, chạy các script `verify-*.mjs` sau khi có tài khoản
test và đọc kỹ script nào có tạo/xóa dữ liệu. Không chạy script sửa kho trên production
nếu chưa có bản sao lưu và phê duyệt.

### Sao lưu và thay đổi database

Mọi thay đổi schema phải tạo migration mới trong `supabase/migrations/`, chạy theo thứ
tự và kiểm tra RLS. Không sửa hoặc xóa migration đã chạy trên production. Sau migration,
kiểm tra đăng nhập, tạo/sửa catalog, checkout, tồn kho, hủy/trả và công nợ.

## 10. Quy tắc an toàn quan trọng

- Server/Supabase là nguồn dữ liệu chuẩn khi online.
- Không sửa trực tiếp bảng `orders`, `order_items`, `stock_movements` để chữa số liệu.
- Không bỏ qua RLS hoặc dùng service-role key ở client.
- Không đóng ca khi còn đơn offline hoặc hàng đợi master-data chưa xử lý.
- Luôn kiểm tra hóa đơn và nhật ký kho sau các thao tác có ảnh hưởng tiền/tồn.
