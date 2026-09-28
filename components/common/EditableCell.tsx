'use client';

// Style CHUNG cho mọi ô sửa được nằm trong danh sách (giỏ POS: số lượng + đơn giá).
// Lấy đúng convention của form hàng hóa (AddProductFormModal: NumberInput "w-full h-8
// px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500") để cùng một
// kiểu chữ/bo/chiều cao ở mọi nơi người dùng được gõ số.
//
// Ô CHỈ ĐỌC dùng READONLY_CELL_CLASS (không viền, xám) -> nhìn là biết chỗ nào sửa
// được, mà không cần chú thích. Quyền sửa vẫn do component cha quyết định.
export const EDIT_CELL_CLASS =
  'h-8 px-2 font-mono text-sm text-slate-800 bg-white border border-slate-300 rounded-md ' +
  'hover:border-blue-400 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được có viền + dấu phân cách hàng nghìn kiểu VN. */
export const editCellClass = (width = 'w-24', extra = '') =>
  `w-full ${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
