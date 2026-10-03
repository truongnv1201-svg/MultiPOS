// Sinh mã thuần túy, không import Dexie/browser để node --test import trực tiếp được.

// Số thứ tự SP lớn nhất đang có (VD SP000013 -> 13). Mã tự sinh phải nối tiếp
// số này chứ không đếm từ hằng số trong RAM (trước đây masterSeq = 12 cứng nên
// project mới nào cũng bắt đầu SP000013, tải lại trang là trùng mã cũ).
export function maxSpNumber(products: { sku?: string }[], prefix: string = 'SP'): number {
  let max = 0;
  for (const p of products) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec((p.sku || '').trim().toUpperCase());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
