'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Nghỉ: ô input NHÌN LÀ BIẾT sửa được — nền hồng nhạt + chữ đỏ, viền hồng nhạt.
// Tương tác: hover viền đậm + nền hồng đậm hơn + chữ đậm; focus viền đỏ + ring.
// Màu chữ cân đo độ tương phản (WCAG AA >= 4.5:1, xem e2e/pos-cart-edit-cells):
//   nghỉ  rose-700 #be123c trên rose-50 -> ~5.8:1 (đọc số tiền thoải mái)
//   hover rose-900 #881337 -> 14+:1 (nhảy màu rõ ràng)
// Ô chỉ đọc dùng READONLY_CELL_CLASS (chữ xám, KHÔNG khung, không nền hồng)
// -> nền hồng = sửa được, xám trơn = chỉ đọc. Quyền sửa do component cha quyết định
// (thu ngân không có ô nhập đơn giá).
export const EDIT_CELL_CLASS =
  'h-8 px-1.5 rounded-md border border-rose-200 bg-rose-50 ' +
  'font-mono text-sm tabular-nums font-semibold text-rose-700 ' +
  'transition-colors duration-100 ' +
  'placeholder:text-rose-300 ' +
  'hover:border-rose-400 hover:bg-rose-100/70 hover:font-bold hover:text-rose-900 ' +
  'focus:border-rose-500 focus:bg-rose-50 focus:outline-hidden focus:ring-2 focus:ring-rose-200 focus:text-rose-950 ' +
  'selection:bg-rose-200';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
