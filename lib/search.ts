// Tìm kiếm dùng chung cho các bảng danh sách (khách, NCC, đơn, hàng hóa, sổ quỹ…).
//
// Vì sao có file này: `toLowerCase().includes()` KHÔNG bỏ dấu nên gõ nhanh không dấu
// ("kinh cuong luc", "nguyen van a") trượt dòng cần tìm; và so từng từ rời nên gõ
// "kinh 10mm" cũng trượt "Kính cường lực 10mm" (có chữ chen giữa).
//
// Riêng ô tìm hàng hóa ở POS cần thêm XẾP HẠNG liên quan (mã khớp lên đầu, cắt top 30)
// — phần đó nằm ở lib/product-search.ts (buildProductIndex/rankProductIndex) và
// import fold() bên dưới (file này là nguồn duy nhất của công thức bỏ dấu).
//
// Ô chọn khách ở POS / sheet thanh toán mobile dùng rankContacts() bên dưới: cùng
// kiểu AND + bỏ dấu, nhưng xếp hạng SĐT/mã trùng hoặc bắt đầu trước tên, và cắt top N
// (trước đây trả về toàn bộ khách khớp nên gõ 1 ký tự là render cả nghìn dòng).
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

// ---- Xếp hạng khách hàng / NCC cho ô chọn nhanh ở POS ----------------------
//
// Vì sao không dùng matchesQuery: khớp AND là đủ để LỌC, nhưng không có thứ tự,
// nên gõ đúng SĐT vẫn có thể nằm sâu trong danh sách (nhất là khi 1 ký tự khớp
// hàng nghìn khách) và dropdown phải render toàn bộ kết quả.
// Thang điểm giữ đúng tinh thần của rankProducts (mã/SĐT khớp tuyệt đối > đầu mã
// > đầu tên > đầu từ > chứa có dấu > chứa không dấu).

const WORD_SEP = /[\s\-_/.,;:()[\]]+/;

export interface SearchableContact {
  name: string;
  phone?: string | null;
  code?: string | null;
}

// SĐT lưu dạng "0901 234 567" vẫn khớp khi gõ liền "0901234567": so thêm bản
// chỉ giữ chữ số. Chỉ áp dụng cho token toàn số để không phá tìm theo tên.
function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '');
}

function contactTier(
  token: string,
  foldedToken: string,
  name: string,
  foldedName: string,
  phone: string,
  phoneDigits: string,
  code: string
): number {
  // Token 1 ký tự mà so với SĐT/mã thì khớp gần như mọi dòng ("0", "k").
  const codeOk = token.length >= 2;
  const tokenDigits = /^\d+$/.test(token) ? token : '';
  // SĐT/mã khớp tuyệt đối (kể cả bỏ khoảng trắng trong SĐT) -> hạng cao nhất.
  if (
    codeOk &&
    (token === phone || token === code || (tokenDigits !== '' && tokenDigits === phoneDigits))
  )
    return 100;
  if (
    codeOk &&
    (phone.startsWith(token) ||
      (tokenDigits !== '' && phoneDigits.startsWith(tokenDigits)) ||
      code.startsWith(token))
  )
    return 80;
  if (name.startsWith(token)) return 70;
  if (name.split(WORD_SEP).some((w) => w !== '' && w.startsWith(token))) return 60;
  if (
    name.includes(token) ||
    (codeOk &&
      (phone.includes(token) ||
        (tokenDigits !== '' && phoneDigits.includes(tokenDigits)) ||
        code.includes(token)))
  )
    return 50;
  if (foldedName.split(WORD_SEP).some((w) => w !== '' && w.startsWith(foldedToken)) || foldedName.includes(foldedToken))
    return 30;
  return -1;
}

/**
 * Lọc + xếp hạng danh sách khách/NCC, trả về tối đa `limit` dòng.
 * - Điểm = tầng yếu nhất trong các từ (AND), giống rankProducts.
 * - Đồng điểm xếp theo tên (đã bỏ dấu) rồi mã: kết quả KHÔNG phụ thuộc thứ tự
 *   mảng đầu vào (server trả theo code, Dexie trả theo id — trước đây top-N lệch nhau).
 * - Query rỗng trả `limit` dòng đầu (không render cả danh sách).
 */
export function rankContacts<T extends SearchableContact>(
  items: readonly T[],
  query: string | null | undefined,
  limit = Number.POSITIVE_INFINITY
): T[] {
  const rawTokens = String(query ?? '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (rawTokens.length === 0) return items.slice(0, limit);
  const foldedTokens = rawTokens.map((t) => fold(t));

  const scored: { item: T; score: number; sortName: string }[] = [];
  for (const item of items) {
    const name = (item.name || '').toLowerCase();
    const foldedName = fold(name);
    const phone = (item.phone || '').toLowerCase().trim();
    const phoneDigits = digitsOnly(phone);
    const code = (item.code || '').toLowerCase().trim();
    let worst = Number.POSITIVE_INFINITY;
    let ok = true;
    for (let k = 0; k < rawTokens.length; k++) {
      const tier = contactTier(rawTokens[k], foldedTokens[k], name, foldedName, phone, phoneDigits, code);
      if (tier < 0) {
        ok = false;
        break;
      }
      if (tier < worst) worst = tier;
    }
    if (!ok) continue;
    scored.push({ item, score: worst, sortName: foldedName });
  }
  // So chuỗi thường (không dùng localeCompare: đồng điểm rất nhiều khi gõ 1-2
  // ký tự, Intl ở mỗi phép so làm chậm cả chục ms mỗi phím).
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0) ||
      compareCode(a.item.code, b.item.code)
  );
  return scored.slice(0, limit).map((s) => s.item);
}

function compareCode(a: string | null | undefined, b: string | null | undefined): number {
  const sa = String(a || '');
  const sb = String(b || '');
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
