// Single source cho toán VỐN & BIÊN LÃI (đối xứng với lib/pricing.ts là toán TIỀN bán).
// Module thuần (không import Dexie/browser) để Node import trực tiếp chạy test.
//
// ═══════════════════════════════════════════════════════════════════
// LUẬT PARITY (bắt buộc khi đổi công thức ở file này):
//   1. Mọi công thức ở đây có bản song sinh trong SQL migration (server là
//      truth khi online) — MAC nằm ở 0042/0048/0053 (v_new_avg), tiền bán ở
//      0023/0007/0027/0050.
//   2. Đổi TS thì phải đổi SQL tương ứng (hoặc ngược lại), rồi chạy:
//        npm test                        (unit, offline)
//        npm run test:parity             (fuzz checkout, cần token)
//      và các script verify-live liên quan (stock-adjust, return, vat...).
//   3. Client chỉ PREVIEW (hiển thị trước cho user) — server chốt số.
// ═══════════════════════════════════════════════════════════════════

// Kết quả preview 1 dòng nhập (chưa ghi): tồn/vốn trước -> sau.
export interface ImportAvgPreview {
  oldStock: number;
  oldAvg: number;
  newStock: number;
  newAvg: number;
}

// Preview giá vốn bình quân (MAC) sau 1 dòng nhập — KHỚP SQL:
//   v_new_avg := case when v_new_stock > 0
//     then round((v_stock * coalesce(v_avg,0) + v_qty * v_price) / v_new_stock)
//     else v_price end;   (0042/0048/0053)
// undefined/null được coi là 0 (như coalesce) để khỏi NaN với dữ liệu cũ.
export function previewImportAvg(
  oldStock: number | null | undefined,
  oldAvg: number | null | undefined,
  qty: number | null | undefined,
  price: number | null | undefined
): ImportAvgPreview {
  const s = Number(oldStock) || 0;
  const a = Number(oldAvg) || 0;
  const q = Number(qty) || 0;
  const p = Number(price) || 0;
  const newStock = s + q;
  return {
    oldStock: s,
    oldAvg: a,
    newStock,
    newAvg: newStock > 0 ? Math.round((s * a + q * p) / newStock) : p,
  };
}

// ── Hủy phiếu nhập (0087): tính ngược đúng số của 0086 ──
// SQL round(numeric) làm tròn nửa-ra-xa-0; Math.round(-0.5) = -0 nên phải bù dấu
// để client mirror khớp server ở mọi trường hợp.
function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}
function round2(n: number): number {
  return roundHalfAwayFromZero(n * 100) / 100;
}

// 0086 ghi gộp giảm dòng + giảm toàn phiếu vào header.discount_amount, không lưu
// cột order_discount_percent. Hủy phiếu phải suy lại giảm toàn phiếu để phân bổ
// y hệt lúc nhập (không âm; dữ liệu cũ không giảm giá -> 0).
export function orderDiscountFromHeader(
  discountAmount: number | null | undefined,
  items: { discount_amount?: number | null }[]
): number {
  const lineSum = items.reduce((s, it) => s + (Number(it.discount_amount) || 0), 0);
  return Math.max(round2((Number(discountAmount) || 0) - lineSum), 0);
}

// Giá nhập net từng dòng đúng như 0086 Pass 2: phân bổ giảm toàn phiếu theo tỉ lệ
// gross, guard bằng gross CỘNG DỒN (giữ nguyên thứ tự để khớp SQL).
export function reversalImportNetPrices(
  items: { quantity: number; unit_price: number; discount_amount?: number | null }[],
  orderDiscount: number,
  subtotal: number
): number[] {
  const od = Number(orderDiscount) || 0;
  const sub = Number(subtotal) || 0;
  let runningGross = 0;
  return items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unit_price) || 0;
    const lineGross = round2(qty * price);
    runningGross += lineGross;
    const alloc = runningGross > 0 && sub > 0 ? round2(od * (lineGross / sub)) : 0;
    const totalLineDiscount = round2((Number(it.discount_amount) || 0) + alloc);
    return qty > 0 ? round2((lineGross - totalLineDiscount) / qty) : price;
  });
}

// Hoàn MAC khi trả hàng: đảo đúng phép cộng của previewImportAvg.
// Tồn không đủ (hàng đã bán) -> chặn ở 0 và báo thiếu; tồn về 0 thì giữ avg = net
// (KHÔNG để 0: trigger trg_init_variant_avg_cost sẽ ghi đè bằng import_price).
export function previewVoidAvg(
  stock: number | null | undefined,
  avg: number | null | undefined,
  qty: number | null | undefined,
  netPrice: number | null | undefined
): { oldStock: number; oldAvg: number; newStock: number; newAvg: number; missing: number } {
  const s = Number(stock) || 0;
  const a = Number(avg) || 0;
  const q = Number(qty) || 0;
  const p = Number(netPrice) || 0;
  const newStock = Math.max(s - q, 0);
  return {
    oldStock: s,
    oldAvg: a,
    newStock,
    newAvg: newStock > 0 ? roundHalfAwayFromZero((s * a - q * p) / newStock) : p,
    missing: Math.max(q - s, 0),
  };
}

// Biên lãi gộp 1 mặt hàng (giá bán vs vốn MAC) — dùng cho bảng Mặt hàng,
// xuất Excel, thẻ KPI. Trả số thô; làm tròn hiển thị (1 hay 2 thập phân) do
// caller quyết vì mỗi nơi một chuẩn (bảng 1dp, Excel 2dp).
export interface LineMargin {
  /** Chênh lệch đồng: giá bán - vốn. */
  amount: number;
  /** % trên giá bán; giá bán <= 0 thì 0 (khỏi chia 0). */
  pct: number;
}

export function lineMargin(
  retailPrice: number | null | undefined,
  avgCost: number | null | undefined
): LineMargin {
  const r = Number(retailPrice) || 0;
  const a = Number(avgCost) || 0;
  const amount = r - a;
  return { amount, pct: r > 0 ? (amount / r) * 100 : 0 };
}

// ── Cộng % trên vốn nhập (máy tính giá bán, form thêm/sửa hàng hóa) ──
// giá = tròn từng đồng(vốn × (1 + m%)); KHÔNG làm tròn nghìn — hàng nhạy giá
// (dây điện...) biến động từng đồng, tròn nghìn là tự bóp biên.
// Thuần client: kết quả ghi vào products.retail_price như gõ tay nên không cần
// bản song sinh SQL (khác MAC/parity ở trên).
export function priceFromMarkup(
  cost: number | null | undefined,
  markupPct: number | null | undefined
): number {
  const c = Number(cost) || 0;
  const m = Number(markupPct) || 0;
  if (c <= 0) return 0;
  return Math.max(0, Math.round(c * (1 + m / 100)));
}

// % đã cộng ngược từ cặp (vốn, giá): vốn <= 0 thì 0 (khỏi chia 0).
export function markupFromPrice(
  cost: number | null | undefined,
  price: number | null | undefined
): number {
  const c = Number(cost) || 0;
  const p = Number(price) || 0;
  if (c <= 0) return 0;
  return ((p - c) / c) * 100;
}

// Vốn 1 dòng đơn để tính lãi kỳ (0078): ưu tiên vốn CHỤP lúc bán (chính xác cho
// đơn mới), dòng cũ chưa có thì fallback MAC hiện tại, mất hàng thì 0.7 giá bán
// (cùng quy ước Tổng quan cũ để số kỳ trước không đổi đột ngột).
export function historicalUnitCost(
  item: { unit_price: number | null | undefined; unit_cost?: number | null },
  products: { id: string; avg_cost: number | null | undefined }[],
  productId: string
): number {
  const snap = Number(item.unit_cost) || 0;
  if (snap > 0) return snap;
  const prod = products.find((p) => p.id === productId);
  if (prod) return Number(prod.avg_cost) || 0;
  return Number(item.unit_price) * 0.7;
}
