'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Tối giản: KHÔNG nền, KHÔNG viền, KHÔNG hiệu ứng hover — nghỉ là chữ xanh,
// ô đã sửa giá là chữ đỏ (PriceDraftInput thêm text-rose-700).
// Xanh nghỉ blue-700 #1d4ed8 -> ~6.7:1, đỏ rose-700 #be123c -> ~6.3:1
// (nền trắng, WCAG AA >= 4.5:1, xem e2e/pos-cart-edit-cells).
// Ô chỉ đọc dùng READONLY_CELL_CLASS (chữ xám) -> xanh = sửa được,
// đỏ = đã sửa giá, xám = chỉ đọc. Quyền sửa do component cha quyết định
// (thu ngân không có ô nhập đơn giá).
export const EDIT_CELL_CLASS =
  'h-8 px-1 rounded-md border-0 bg-transparent ' +
  'font-mono text-sm tabular-nums font-semibold text-blue-700 ' +
  'placeholder:text-slate-300 ' +
  'focus:outline-hidden ' +
  'selection:bg-blue-200';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
