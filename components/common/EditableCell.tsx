'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Hướng "underlined field": không khung, không nền — chỉ một đường gạch chân bên dưới và
// chữ màu xanh để thấy ngay chỗ nào gõ được. Ít đường viền nên bảng nhìn thoáng và gọn.
// Ưu tiên border-b-2 (không phải 1px) ở cả trạng thái nghỉ lẫn focus để khi focus không
// nhảy dòng 1px.
//
// Ô CHỈ ĐỌC dùng READONLY_CELL_CLASS (chữ xám, không gạch chân) -> nhìn là biết chỗ nào
// sửa được, không cần chú thích. Quyền sửa do component cha quyết định.
export const EDIT_CELL_CLASS =
  'h-8 border-0 border-b-2 border-b-slate-200 bg-transparent px-1 ' +
  'font-mono text-sm tabular-nums text-blue-700 transition-colors ' +
  'placeholder:text-slate-300 hover:border-b-slate-400 hover:text-blue-800 ' +
  'focus:border-b-blue-600 focus:text-blue-900 focus:outline-hidden';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
