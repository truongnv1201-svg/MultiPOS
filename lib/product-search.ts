// Tìm kiếm mặt hàng ở POS: lọc thô + chấm điểm liên quan (thuần, test được).
//
// Vấn đề gốc 1: gõ "34" ra 262 món, dropdown cắt 8 món đầu theo mã nên món cần
// (VD "ỐNG TP 34 C2", mã cũ) chìm nghỉm. Cách sửa: bắt buộc trúng MỌI từ gõ
// (AND), xếp tầng liên quan, có dấu luôn trước không dấu.
//
// Vấn đề gốc 2 (10/2026): gõ "mặt S 2" KHÔNG ra "MẶT S 2 Ổ 1 LỖ". Vì điểm món =
// TẦNG YẾU NHẤT trong các từ, nên mọi món có chữ "mặt" + số "2" đều 60 điểm;
// hoà điểm thì xếp theo mã, đẩy món đúng xuống hạng 13/61 và bị cắt khỏi top 8.
// Vấn đề gốc 3: gõ "mặt 2" cũng trượt, vì hai từ KHÔNG liền nhau trong tên
// ("MẶT S 2 ..." có chữ S chen giữa) nên cách so cụm-liền-mạch không bắt được.
// Cách sửa:
//   - đo "cửa sổ" hẹp nhất chứa đủ các từ gõ THEO THỨ TỰ (bestWindow): cửa sổ
//     càng hẹp và bắt đầu càng sớm thì điểm càng cao -> "MẶT S 2 ..." thắng
//     "BĂNG DÁN MẶT TRẮNG XỊN 2 1CM" dù cả hai đều có chữ "mặt" và số "2";
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
 * Cửa sổ HẸP NHẤT trong tên chứa đủ mọi từ gõ THEO ĐÚNG THỨ TỰ (mỗi từ khớp
 * "đầu từ": "2" khớp "2"/"2mm" nhưng không khớp "12"). null = không có cửa sổ.
 *
 * Vì sao cần: gõ "mặt 2" thì hai từ KHÔNG liền nhau trong "MẶT S 2 Ổ 1 LỖ"
 * (có chữ "S" chen giữa), nên cách so cụm-từ-liền-mạch không bắt được. Đo cửa sổ
 * giúp phân biệt "MẶT S 2..." (cửa sổ 3 từ, bắt đầu ở từ 0) với
 * "BĂNG DÁN MẶT TRẮNG XỊN 2 1CM" (cửa sổ 4 từ, bắt đầu ở từ 2).
 */
function bestWindow(nameWords: string[], tokens: string[]): { start: number; span: number } | null {
  let best: { start: number; span: number } | null = null;
  for (let i = 0; i < nameWords.length; i++) {
    let at = i;
    let last = -1;
    let ok = true;
    for (const t of tokens) {
      let found = -1;
      for (let j = at; j < nameWords.length; j++) {
        if (nameWords[j].startsWith(t)) {
          found = j;
          break;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      last = found;
      at = found + 1;
    }
    // Không khớp từ vị trí i thì i+1.. cũng không thể (chỉ ít chỗ hơn) -> dừng.
    if (!ok) break;
    const span = last - i + 1;
    if (!best || span < best.span || (span === best.span && i < best.start)) {
      best = { start: i, span };
    }
  }
  return best;
}

/**
 * Lọc + xếp hạng mặt hàng theo chuỗi gõ (AND giữa các từ, cách nhau khoảng trắng).
 * Điểm món = tầng yếu nhất trong các từ (mọi từ đều phải trúng mới giữ), NÂNG lên
 * theo "cửa sổ" khi các từ gõ nằm gần nhau và sớm trong tên (xem bestWindow) —
 * nhờ vậy "mặt 2" ra đúng nhóm "MẶT S 2 ..." thay vì món chỉ tình cờ có 2 chữ đó.
 * Sort ổn định nên đồng điểm giữ đúng thứ tự danh mục cũ (mã mới trước).
 * Caller tự slice top-N (POS dropdown cắt 30).
 */
export function rankProducts<T extends SearchableProduct>(items: T[], query: string): T[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return [];
  const foldedTokens = tokens.map((t) => foldAccents(t));
  // Cửa sổ chỉ có nghĩa khi gõ >= 2 từ; 1 từ đã được tokenTier xếp tầng đủ.
  const useWindow = tokens.length >= 2;
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const name = (item.name || '').toLowerCase();
    const foldedName = foldAccents(item.name || '');
    const sku = (item.sku || '').toLowerCase();
    const barcode = (item.barcode || '').toLowerCase();
    let worst = Infinity;
    let ok = true;
    for (let k = 0; k < tokens.length; k++) {
      const tier = tokenTier(tokens[k], foldedTokens[k], name, foldedName, sku, barcode);
      if (tier < 0) {
        ok = false;
        break;
      }
      if (tier < worst) worst = tier;
    }
    if (!ok) continue;
    let score = worst;
    if (useWindow) {
      // Khớp nguyên văn (có dấu) luôn trên khớp không dấu.
      const raw = bestWindow(name.split(WORD_SEP).filter((w) => w !== ''), tokens);
      const folded = raw
        ? null
        : bestWindow(foldedName.split(WORD_SEP).filter((w) => w !== ''), foldedTokens);
      const w = raw ?? folded;
      if (w) {
        const base = raw ? 5000 : 4000;
        const windowed = base - (w.span - tokens.length) * 60 - w.start * 100;
        if (windowed > score) score = windowed;
      }
    }
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
