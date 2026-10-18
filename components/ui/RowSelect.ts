// Hiệu ứng "pick chọn dòng" dùng chung cho MỌI bảng / danh sách dạng master-detail:
// Đơn hàng, Nhập kho, Khách hàng, Nhà cung cấp, Chứng từ xuất, Công trình, Hàng hóa.
//
// Bệnh cũ: mỗi bảng tự viết một kiểu (bg-blue-50/80, bg-blue-50/70, border-l-blue-600...)
// nên lệch nhau, lại quá nhạt — bảng nhiều cột thì không thấy mình đang thao tác ở dòng
// nào (người dùng báo ở trang Hàng hóa). Chốt MỘT nguồn duy nhất ở đây:
// nền blue-100 + chữ đậm + vạch xanh 4px bên trái.
//
// Vì sao vạch vẽ bằng background-image (gradient) chứ không phải border:
//   - Mọi bảng trong app đều `border-collapse: collapse`; border trên <tr> ở chế độ đó
//     vẫn chiếm chỗ (đo thực tế: bảng bị đẩy 2px khi bấm dòng) và không vẽ ổn định.
//   - Vạch bằng border trên ô đầu thì đẩy chữ 4px, lệch hẳn so với header cùng cột.
//   - Gradient không chiếm chỗ nên đổi dòng KHÔNG nhảy cột, và dùng chung được cho
//     cả <tr>, <div> và <button> của các danh sách.
//
// Muốn đổi độ nổi bật của hiệu ứng chọn dòng trong CẢ APP thì sửa đúng file này.
const ROW_BAR = '[background-image:linear-gradient(to_right,#3b82f6_0_4px,transparent_4px)]';

/** Dòng/mục ĐANG được chọn. */
export const ROW_SELECTED = `bg-blue-100 font-medium ${ROW_BAR}`;

/** Dòng/mục thường — chỉ hover xám. */
export const ROW_IDLE = 'hover:bg-slate-50';

/** Class nền theo trạng thái chọn — truyền thẳng vào className của <tr>/<div>/<button>. */
export const rowSelectClass = (selected: boolean) => (selected ? ROW_SELECTED : ROW_IDLE);
