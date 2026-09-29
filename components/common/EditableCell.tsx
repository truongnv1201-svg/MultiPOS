'use client';

// Style CHUNG cho mọi ô sửa được nằm trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Hướng "quiet field" (kiểu Linear/Vercel): nghỉ thì lặng lẽ — nền xám rất nhạt + viền mảnh,
// hover thì nổi lên nền trắng, focus thì viền xanh + quầng mềm. Ô không "hét" giữa bảng
// mà vẫn thấy rõ là chỗ gõ được. tabular-nums để chữ số thẳng cột khi đổi giá trị.
//
// Ô CHỈ ĐỌC dùng READONLY_CELL_CLASS (không viền, xám) -> nhìn là biết chỗ nào sửa được,
// mà không cần chú thích. Quyền sửa vẫn do component cha quyết định.
export const EDIT_CELL_CLASS =
  'h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-mono text-sm tabular-nums ' +
  'text-slate-700 transition-colors duration-100 placeholder:text-slate-400 ' +
  'hover:border-slate-300 hover:bg-white hover:text-slate-900 ' +
  'focus:border-blue-500 focus:bg-white focus:text-slate-900 focus:ring-4 focus:ring-blue-500/10 ' +
  'focus:outline-hidden';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') =>
  `w-full ${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
