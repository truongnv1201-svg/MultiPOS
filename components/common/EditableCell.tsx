'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Cực gọn: KHÔNG viền, KHÔNG nền, KHÔNG gạch chân — dấu hiệu "sửa được" là CHỮ MÀU XANH.
// Ít đường nét nhất có thể nên bảng thoáng; người bán vẫn nhận ra chỗ gõ được ngay.
// Hover đậm lên (font-semibold -> font-bold) để có phản hồi khi rê chuột mà không thêm khung.
// Vì hover là pseudo-class nên thắng mọi class font-weight thường, không cần `!`.
// Ô chỉ đọc dùng READONLY_CELL_CLASS (chữ xám) -> xám = không sửa, xanh = sửa được.
// Quyền sửa do component cha quyết định (thu ngân không có ô nhập đơn giá).
export const EDIT_CELL_CLASS =
  'h-8 border-0 bg-transparent p-0 ' +
  'font-mono text-sm tabular-nums font-semibold text-blue-700 transition-colors ' +
  'placeholder:text-slate-300 hover:font-bold hover:text-blue-800 focus:text-blue-900 focus:outline-hidden ' +
  'selection:bg-blue-200';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
