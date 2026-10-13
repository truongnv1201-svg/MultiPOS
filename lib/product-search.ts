// Tìm kiếm mặt hàng ở POS: lọc thô + chấm điểm liên quan (thuần, test được).
// Vấn đề gốc: gõ "34" ra 262 món, dropdown cắt 8 món đầu theo mã nên món cần
// (VD "ỐNG TP 34 C2", mã cũ) chìm nghỉm. Cách sửa: bắt buộc trúng MỌI từ gõ
// (AND), xếp tầng liên quan, có dấu luôn trước không dấu.

export interface SearchableProduct {
  name: string;
  sku: string;
  barcode?: string | null;
}

// Bỏ dấu để so fallback: NFD tách dấu tổ hợp + đ/Đ là chữ riêng phải đổi tay.
export function foldAccents(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

const WORD_SEP = /[\s\-_/.,;:()[\]]+/;

// Điểm 1 từ khóa trên 1 mặt hàng (cao = liên quan hơn, -1 = không trúng).
// Tầng đúng như đã chốt với user: mã tuyệt đối > đầu mã > đầu tên > đầu từ
// > chứa (có dấu) > chứa (không dấu, fallback).
function tokenTier(
  token: string,
  foldedToken: string,
  name: string,
  foldedName: string,
  sku: string,
  barcode: string
): number {
  if (token === sku || (barcode !== '' && token === barcode)) return 100;
  if (sku.startsWith(token)) return 80;
  if (name.startsWith(token)) return 70;
  if (name.split(WORD_SEP).some((w) => w !== '' && w.startsWith(token))) return 60;
  if (name.includes(token) || sku.includes(token) || (barcode !== '' && barcode.includes(token))) return 50;
  const foldedSku = foldAccents(sku);
  if (
    foldedName.split(WORD_SEP).some((w) => w !== '' && w.startsWith(foldedToken)) ||
    foldedName.includes(foldedToken) ||
    foldedSku.includes(foldedToken)
  )
    return 30;
  return -1;
}

/**
 * Lọc + xếp hạng mặt hàng theo chuỗi gõ (AND giữa các từ, cách nhau khoảng trắng).
 * Điểm món = tầng yếu nhất trong các từ (mọi từ đều phải trúng mới giữ).
 * Sort ổn định nên đồng điểm giữ đúng thứ tự danh mục cũ (mã mới trước).
 * Caller tự slice top-N (POS dropdown cắt 8).
 */
export function rankProducts<T extends SearchableProduct>(items: T[], query: string): T[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return [];
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const name = (item.name || '').toLowerCase();
    const foldedName = foldAccents(item.name || '');
    const sku = (item.sku || '').toLowerCase();
    const barcode = (item.barcode || '').toLowerCase();
    let worst = Infinity;
    let ok = true;
    for (const t of tokens) {
      const tier = tokenTier(t, foldAccents(t), name, foldedName, sku, barcode);
      if (tier < 0) {
        ok = false;
        break;
      }
      if (tier < worst) worst = tier;
    }
    if (ok) scored.push({ item, score: worst });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
