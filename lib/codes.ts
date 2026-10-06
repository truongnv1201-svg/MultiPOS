// Sinh mã thuần túy, không import Dexie/browser để node --test import trực tiếp được.

// Số thứ tự lớn nhất đang có cho một đầu mã (VD SP000013 -> 13, KH0002 -> 2).
// Mã tự sinh phải nối tiếp số này chứ không đếm theo số lượng (xóa rồi tạo lại
// sẽ lấp số cũ) hay hằng số RAM. Bỏ qua mã sai định dạng.
export function maxCodeNumber(codes: Array<string | undefined | null>, prefix: string = 'SP'): number {
  let max = 0;
  for (const code of codes) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec((code || '').trim().toUpperCase());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

// Số thứ tự SP lớn nhất đang có (VD SP000013 -> 13). Mã tự sinh phải nối tiếp
// số này chứ không đếm từ hằng số trong RAM (trước đây masterSeq = 12 cứng nên
// project mới nào cũng bắt đầu SP000013, tải lại trang là trùng mã cũ).
export function maxSpNumber(products: { sku?: string }[], prefix: string = 'SP'): number {
  return maxCodeNumber(
    products.map((p) => p.sku),
    prefix
  );
}

// Tem ngày YYMMDD cho mã phiếu (NH/PQ) — giờ local như generateOrderCode.
export function dailyCodeStamp(at: Date = new Date()): string {
  const yy = String(at.getFullYear()).slice(-2);
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Mã phiếu tiếp theo PREFIX-YYMMDD-NNNN (VD NH-261006-0012).
// Quét cả mã cũ có hậu tố random (thời kỳ trước) để không lùi số; mã sai
// định dạng hoặc khác ngày thì bỏ qua. Caller phải gộp mã local + mã server
// (phiếu máy khác) rồi mới gọi — max local đơn thuần vẫn trùng liên máy.
export function nextDailyCode(
  codes: Array<string | undefined | null>,
  prefix: string,
  stamp: string = dailyCodeStamp()
): string {
  let max = 0;
  for (const code of codes) {
    const m = new RegExp(`^${prefix}-(\\d{6})-(\\d+)`).exec((code || '').trim().toUpperCase());
    if (m && m[1] === stamp) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${prefix}-${stamp}-${String(max + 1).padStart(4, '0')}`;
}
