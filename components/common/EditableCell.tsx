'use client';

// Style CHUNG cho mọi ô sửa được trong danh sách (giỏ POS: số lượng + đơn giá).
//
// Nghỉ: KHÔNG viền, KHÔNG nền, KHÔNG gạch chân — dấu hiệu "sửa được" là CHỮ MÀU XANH.
//       Bảng dày nên trạng thái nghỉ phải im, nhưng mọi phản hồi tương tác thì phải RÕ.
//
// Tương tác (theo thứ tự dễ nhận nhất):
//   hover -> nền xanh rất nhạt + viền xanh nhạt bo tròn (vùng bấm nổi lên) + chữ đậm.
//            Chỉ đổi độ đậm (600->700) là KHÔNG đủ: ở 14px trong bảng dày mắt gần như
//            không thấy, đó là lý do hover trước đó bị coi là "không phản hồi".
//   focus -> nền xanh nhạt + viền xanh đậm hơn (đang gõ dòng nào rõ ngay).
// Vì hover/focus là pseudo-class nên chúng thắng mọi utility thường, không cần `!`.
// Ô chỉ đọc dùng READONLY_CELL_CLASS (chữ xám) -> xám = không sửa, xanh = sửa được.
// Quyền sửa do component cha quyết định (thu ngân không có ô nhập đơn giá).
export const EDIT_CELL_CLASS =
  'h-8 border-0 bg-transparent p-0 rounded-md ' +
  'font-mono text-sm tabular-nums font-semibold text-blue-700 ' +
  'transition-[background-color,box-shadow,color,font-weight] duration-100 ' +
  'placeholder:text-slate-300 ' +
  'hover:bg-blue-50 hover:font-bold hover:text-blue-900 hover:ring-1 hover:ring-blue-300 ' +
  'focus:bg-blue-50 focus:text-blue-900 focus:ring-1 focus:ring-blue-500 focus:outline-hidden ' +
  'selection:bg-blue-200';

export const READONLY_CELL_CLASS = 'font-mono text-sm text-slate-500 select-none';

/** Ô sửa được: rộng theo cột, canh chữ do caller thêm. */
export const editCellClass = (width = 'w-24', extra = '') => `${width} ${EDIT_CELL_CLASS} ${extra}`.trim();

/** Ô chỉ đọc: canh phải, không viền. */
export const readOnlyCellClass = (extra = '') => `text-right ${READONLY_CELL_CLASS} ${extra}`.trim();
