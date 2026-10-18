// Tìm kiếm dùng chung cho các bảng danh sách (khách, NCC, đơn, hàng hóa, sổ quỹ…).
//
// Vì sao có file này: `toLowerCase().includes()` KHÔNG bỏ dấu nên gõ nhanh không dấu
// ("kinh cuong luc", "nguyen van a") trượt dòng cần tìm; và so từng từ rời nên gõ
// "kinh 10mm" cũng trượt "Kính cường lực 10mm" (có chữ chen giữa).
//
// Riêng ô tìm hàng hóa ở POS cần thêm XẾP HẠNG liên quan (mã khớp lên đầu, cắt top 8)
// — phần đó nằm ở lib/product-search.ts (rankProducts) và dùng lại fold() bên dưới.
//
// Module thuần (không import Dexie/browser) để Node import trực tiếp chạy test.
//
// Quy ước:
//   - fold(): bỏ dấu + 'đ'->'d' + thường hoá. LƯU Ý 'đ/Đ' (U+0111) KHÔNG bị NFD tách
//     nên phải map tay, không thì "duong" vẫn trượt "đường".
//   - Token AND: mọi token phải xuất hiện (trong 1 trong các trường) — nhờ vậy
//     "kinh 10mm" khớp "Kính cường lực 10mm Việt Nhật".

export function fold(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

export function tokenize(query: string | null | undefined): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * Khớp token AND trên 1 hay nhiều trường. query rỗng = khớp tất (giữ hành vi
 * "chưa gõ gì thì không lọc"). Dùng cho mọi bảng danh sách.
 */
export function matchesQuery(
  fields: Array<string | null | undefined>,
  query: string | null | undefined
): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const haystack = fields.filter(Boolean).map((f) => fold(f)).join(' ');
  return tokens.every((t) => haystack.includes(t));
}
