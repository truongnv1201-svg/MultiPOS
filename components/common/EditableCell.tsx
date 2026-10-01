'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Nghỉ: ô input NHÌN LÀ BIẾT sửa được — viền + nền trắng, chữ xanh dương.
// (Triết lý cũ "chỉ màu chữ, không viền/nền" khiến ô lẫn với chữ tĩnh, thu ngân
// mới không biết bấm vào đâu.)
// Tương tác: hover viền xanh + nền xanh nhạt + chữ đậm; focus viền xanh + ring.
// Màu chữ cân đo độ tương phản (nền trắng, WCAG AA >= 4.5:1, xem e2e/pos-cart-edit-cells):
//   nghỉ  blue-700 #1d4ed8 -> ~6.7:1 (đọc số tiền thoải mái)
//   hover blue-900 #162556 -> 14.65:1 (nhảy màu rõ ràng)
// Ô chỉ đọc dùng READONLY_CELL_CLASS (chữ xám, KHÔNG khung) -> có khung = sửa được,
// không khung = chỉ đọc. Quyền sửa do component cha quyết định
// (thu ngân không có ô nhập đơn giá).
export const EDIT_CELL_CLASS =
  'h-8 px-1.5 rounded-md border border-slate-200 bg-white ' +
  'font-mono text-sm tabular-nums font-semibold text-blue-700 ' +
  'transition-colors duration-100 ' +
  'placeholder:text-slate-300 ' +
  'hover:border-blue-400 hover:bg-blue-50/60 hover:font-bold hover:text-blue-900 ' +
  'focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-200 focus:text-blue-950 ' +
  'selection:bg-blue-200';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
