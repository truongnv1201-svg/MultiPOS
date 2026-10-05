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
