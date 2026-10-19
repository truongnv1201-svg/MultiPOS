// Tìm kiếm mặt hàng ở POS: lọc thô + chấm điểm liên quan (thuần, test được).
//
// Vấn đề gốc 1: gõ "34" ra 262 món, dropdown cắt 8 món đầu theo mã nên món cần
// (VD "ỐNG TP 34 C2", mã cũ) chìm nghỉm. Cách sửa: bắt buộc trúng MỌI từ gõ
// (AND), xếp tầng liên quan, có dấu luôn trước không dấu.
//
// Vấn đề gốc 2 (10/2026): gõ "mặt S 2" KHÔNG ra "MẶT S 2 Ổ 1 LỖ". Vì điểm món =
// TẦNG YẾU NHẤT trong các từ, nên mọi món có chữ "mặt" + số "2" đều 60 điểm;
// hoà điểm thì xếp theo mã, đẩy món đúng xuống hạng 13/61 và bị cắt khỏi top 8.
// Cách sửa:
//   - cộng hạng "cả cụm từ nằm liền trong tên" cho truy vấn >= 2 từ (mặt s 2 là
//     đầu tên "MẶT S 2 Ổ 1 LỖ" -> hạng cao, thắng đám khớp rời rạc);
//   - từ 1 ký tự KHÔNG được khớp vào mã: mọi SKU đều bắt đầu bằng "SP" nên chữ
//     "s" trước đây khớp cả 5.000 món và làm loãng kết quả.

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
  // Từ 1 ký tự chỉ so với TÊN. So với mã là vô nghĩa ("s" khớp mọi SKU "SP...").
  const codeOk = token.length >= 2;
  if (codeOk && (token === sku || (barcode !== '' && token === barcode))) return 100;
  if (codeOk && sku.startsWith(token)) return 80;
  if (name.startsWith(token)) return 70;
  if (name.split(WORD_SEP).some((w) => w !== '' && w.startsWith(token))) return 60;
  if (name.includes(token) || (codeOk && (sku.includes(token) || (barcode !== '' && barcode.includes(token)))))
    return 50;
  const foldedSku = foldAccents(sku);
  if (
    foldedName.split(WORD_SEP).some((w) => w !== '' && w.startsWith(foldedToken)) ||
    foldedName.includes(foldedToken) ||
    (codeOk && foldedSku.includes(foldedToken))
  )
    return 30;
  return -1;
}

/**
 * Hạng "cả cụm từ nằm trong tên" (chỉ dùng cho truy vấn >= 2 từ; 1 từ đã đủ
 * tầng ở tokenTier). Khớp nguyên văn có dấu luôn trên khớp không dấu.
 */
function phraseTier(
  name: string,
  foldedName: string,
  query: string,
  foldedQuery: string
): number {
  if (name.startsWith(query)) return 950;
  if (name.includes(query)) return 900;
  if (foldedName.startsWith(foldedQuery)) return 870;
  if (foldedName.includes(foldedQuery)) return 860;
  return 0;
}

/**
 * Lọc + xếp hạng mặt hàng theo chuỗi gõ (AND giữa các từ, cách nhau khoảng trắng).
 * Điểm món = tầng yếu nhất trong các từ (mọi từ đều phải trúng mới giữ), NÂNG lên
 * nếu cả cụm từ gõ nằm liền mạch trong tên.
 * Sort ổn định nên đồng điểm giữ đúng thứ tự danh mục cũ (mã mới trước).
 * Caller tự slice top-N (POS dropdown cắt 8).
 */
export function rankProducts<T extends SearchableProduct>(items: T[], query: string): T[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return [];
  // Chuỗi gõ đã chuẩn hoá khoảng trắng: bản có dấu + bản bỏ dấu.
  const rawQuery = tokens.join(' ');
  const foldedQuery = foldAccents(rawQuery);
  const usePhrase = tokens.length >= 2;
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
    if (!ok) continue;
    const phrase = usePhrase ? phraseTier(name, foldedName, rawQuery, foldedQuery) : 0;
    scored.push({ item, score: phrase > worst ? phrase : worst });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
