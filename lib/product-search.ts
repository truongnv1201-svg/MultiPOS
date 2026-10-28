// Tìm kiếm mặt hàng ở POS: index tĩnh + chấm điểm liên quan (thuần, test được).
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
//
// Vấn đề gốc 4 (perf, 10/2026): mỗi phím gõ lại bỏ dấu + tách từ cho TẤT CẢ mặt
// hàng (~5.000) nên tốn 12-24ms/phím ở desktop, mobile chậm hơn nhiều. Cách sửa:
// buildProductIndex() làm 1 lần khi danh mục đổi; rankProductIndex() chỉ chấm điểm
// trên dữ liệu đã bỏ dấu sẵn (gọi trong useMemo của ô tìm). rankProducts() giữ
// nguyên như wrapper tiện cho test/caller cũ.
//
// Hoà điểm: xếp theo SKU TĂNG DẦN (đúng thứ tự server trả `.order('sku')`) chứ không
// phụ thuộc thứ tự mảng đầu vào — online (server sort sku tăng) và offline (Dexie sort
// theo id) trước đây cho top-30 khác nhau ở các dòng đồng điểm.

import { fold } from './search.ts';

export interface SearchableProduct {
  name: string;
  sku: string;
  barcode?: string | null;
}

// Giữ tên cũ cho test/caller; công thức duy nhất nằm ở lib/search.ts.
export const foldAccents = fold;

const WORD_SEP = /[\s\-_/.,;:()[\]]+/;

function wordsOf(s: string): string[] {
  return s.split(WORD_SEP).filter((w) => w !== '');
}

// Mặt hàng đã bỏ dấu + tách từ sẵn. Tạo 1 lần cho mỗi lần danh mục đổi.
export interface IndexedProduct<T extends SearchableProduct> {
  item: T;
  name: string;
  foldedName: string;
  nameWords: string[];
  foldedNameWords: string[];
  sku: string;
  foldedSku: string;
  barcode: string;
}

export function buildProductIndex<T extends SearchableProduct>(items: readonly T[]): IndexedProduct<T>[] {
  return items.map((item) => {
    const name = (item.name || '').toLowerCase();
    const foldedName = fold(name);
    const sku = (item.sku || '').toLowerCase();
    return {
      item,
      name,
      foldedName,
      nameWords: wordsOf(name),
      foldedNameWords: wordsOf(foldedName),
      sku,
      foldedSku: fold(sku),
      barcode: (item.barcode || '').toLowerCase(),
    };
  });
}

// Điểm 1 từ khóa trên 1 mặt hàng (cao = liên quan hơn, -1 = không trúng).
// Tầng đúng như đã chốt với user: mã tuyệt đối > đầu mã > đầu tên > đầu từ
// > chứa (có dấu) > chứa (không dấu, fallback).
function tokenTier(token: string, foldedToken: string, e: IndexedProduct<SearchableProduct>): number {
  // Từ 1 ký tự chỉ so với TÊN. So với mã là vô nghĩa ("s" khớp mọi SKU "SP...").
  const codeOk = token.length >= 2;
  if (codeOk && (token === e.sku || (e.barcode !== '' && token === e.barcode))) return 100;
  if (codeOk && e.sku.startsWith(token)) return 80;
  if (e.name.startsWith(token)) return 70;
  if (e.nameWords.some((w) => w.startsWith(token))) return 60;
  if (
    e.name.includes(token) ||
    (codeOk && (e.sku.includes(token) || (e.barcode !== '' && e.barcode.includes(token))))
  )
    return 50;
  if (
    e.foldedNameWords.some((w) => w.startsWith(foldedToken)) ||
    e.foldedName.includes(foldedToken) ||
    (codeOk && e.foldedSku.includes(foldedToken))
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
 * Lọc + xếp hạng mặt hàng ĐÃ index theo chuỗi gõ (AND giữa các từ, cách nhau
 * khoảng trắng). Điểm món = tầng yếu nhất trong các từ (mọi từ đều phải trúng mới
 * giữ), NÂNG lên theo "cửa sổ" khi các từ gõ nằm gần nhau và sớm trong tên (xem
 * bestWindow) — nhờ vậy "mặt 2" ra đúng nhóm "MẶT S 2 ..." thay vì món chỉ tình cờ
 * có 2 chữ đó. Đồng điểm xếp theo SKU tăng dần (giống thứ tự server trả) để
 * online/offline cùng một kết quả. Caller tự slice top-N (POS dropdown cắt 30).
 */
export function rankProductIndex<T extends SearchableProduct>(
  index: readonly IndexedProduct<T>[],
  query: string
): T[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return [];
  const foldedTokens = tokens.map((t) => fold(t));
  // Cửa sổ chỉ có nghĩa khi gõ >= 2 từ; 1 từ đã được tokenTier xếp tầng đủ.
  const useWindow = tokens.length >= 2;
  const scored: { item: T; score: number }[] = [];
  for (const e of index) {
    let worst = Number.POSITIVE_INFINITY;
    let ok = true;
    for (let k = 0; k < tokens.length; k++) {
      const tier = tokenTier(tokens[k], foldedTokens[k], e);
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
      const raw = bestWindow(e.nameWords, tokens);
      const folded = raw ? null : bestWindow(e.foldedNameWords, foldedTokens);
      const w = raw ?? folded;
      if (w) {
        const base = raw ? 5000 : 4000;
        const windowed = base - (w.span - tokens.length) * 60 - w.start * 100;
        if (windowed > score) score = windowed;
      }
    }
    scored.push({ item: e.item, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || compareSku(String(a.item.sku || ''), String(b.item.sku || ''))
  );
  return scored.map((s) => s.item);
}

/**
 * So SKU tự nhiên (SP9 < SP10) bằng so từng ký tự số, KHÔNG dùng localeCompare:
 * comparator chạy O(n log n) và khi cả danh sách đồng điểm (gõ "kinh" khớp mọi
 * tên) thì Intl.collator làm mỗi phím gõ chậm thêm 20-30ms.
 */
function compareSku(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(j);
    const digitA = ca >= 48 && ca <= 57;
    const digitB = cb >= 48 && cb <= 57;
    if (digitA && digitB) {
      let endA = i;
      let endB = j;
      while (endA < a.length && a.charCodeAt(endA) >= 48 && a.charCodeAt(endA) <= 57) endA++;
      while (endB < b.length && b.charCodeAt(endB) >= 48 && b.charCodeAt(endB) <= 57) endB++;
      const numA = Number(a.slice(i, endA));
      const numB = Number(b.slice(j, endB));
      if (numA !== numB) return numA - numB;
      i = endA;
      j = endB;
      continue;
    }
    if (ca !== cb) return ca - cb;
    i++;
    j++;
  }
  return a.length - i - (b.length - j);
}

/** Tiện dụng cho caller/test cũ: tự build index rồi xếp hạng. */
export function rankProducts<T extends SearchableProduct>(items: readonly T[], query: string): T[] {
  return rankProductIndex(buildProductIndex(items), query);
}
