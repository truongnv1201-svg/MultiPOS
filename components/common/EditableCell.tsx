'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Nghỉ: KHÔNG viền, KHÔNG nền, KHÔNG gạch chân — chỉ màu chữ.
// Tương tác: đổi màu chữ theo độ sáng + đậm lên. KHÔNG bôi nền (dễ mất dòng khi rê nhiều ô)
//        và chỉ đổi độ đậm thì không đủ để mắt nhận ở 14px trong bảng dày.
// Màu chọn có cân đo độ tương phản (đo bằng WCAG trên nền trắng, xem e2e/pos-cart-edit-cells):
//   nghỉ  blue-600 #155dfc -> 4.66:1  (>= AA 4.5:1: đọc số tiền thoải mái)
//   hover blue-900 #162556 -> 14.65:1 (nhảy sáng mạnh, không cần nền để thấy)
//   focus blue-950        -> 16:1+
//   KHÔNG dùng blue-500 ở trạng thái nghỉ: chỉ 3.76:1, dưới AA -> giá khó đọc.
// Vì hover/focus là pseudo-class nên thắng mọi utility thường, không cần `!`.
// Ô chỉ đọc dùng READONLY_CELL_CLASS (chữ xám) -> xám = không sửa, xanh = sửa được.
// Quyền sửa do component cha quyết định (thu ngân không có ô nhập đơn giá).
export const EDIT_CELL_CLASS =
  'h-8 border-0 bg-transparent p-0 ' +
  'font-mono text-sm tabular-nums font-semibold text-blue-600 ' +
  'transition-colors duration-100 ' +
  'placeholder:text-slate-300 ' +
  'hover:font-bold hover:text-blue-900 focus:text-blue-950 focus:outline-hidden ' +
  'selection:bg-blue-200';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
