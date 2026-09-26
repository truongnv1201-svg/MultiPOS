'use client';

// Số lượng bán: mặt hàng bán theo cân nặng/thể tích cần số thập phân (2,15 kg),
// còn hàng đếm theo cái/bao thì giữ số nguyên. DB đã là numeric(14,3) và RPC
// pos_checkout dùng NUMERIC nên chỉ cần chuẩn hoá ở tầng client.

/** numeric(14,3) — tối đa 3 chữ số thập phân. */
export const QTY_MAX_DECIMALS = 3;

/** Đơn vị thường bán theo số thập phân — dùng để gợi ý tick cờ trong form hàng. */
const DECIMAL_UNITS = ['kg', 'g', 'gram', 'l', 'lít', 'lit', 'ml', 'tạ', 'yến', 'lạng', 'kg/thùng'];

/** Hàng m² luôn dùng số thập phân (F3 tính ra số thực), không phụ thuộc cờ. */
export function isAreaProduct(productType?: string): boolean {
  return productType === 'area';
}

/** Mặt hàng có được bán số lượng thập phân không. */
export function allowsDecimalQty(input?: { product_type?: string; allow_decimal?: boolean } | null): boolean {
  if (!input) return false;
  if (isAreaProduct(input.product_type)) return true;
  return input.allow_decimal === true;
}

/** Gợi ý tick cờ khi đơn vị là kg/l... (không tự động bật, chỉ để form pre-check). */
export function suggestDecimalForUnit(unit?: string): boolean {
  if (!unit) return false;
  const u = unit.trim().toLowerCase();
  return DECIMAL_UNITS.some((d) => u === d || u.startsWith(`${d}/`) || u.startsWith(`${d} `));
}

/**
 * Chuẩn hoá chuỗi người dùng gõ trong ô số lượng:
 * - có dấu phẩy -> kiểu VN, dấu chấm là phân cách nghìn ("1.234,56" -> 1234.56)
 * - nhiều dấu chấm -> phân cách nghìn ("1.234.567" -> 1234567)
 * - một dấu chấm -> dấu thập phân, vì số lượng tối đa 3 chữ số lẻ ("2.15" -> 2.15)
 */
export function parseQtyInput(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!cleaned) return 0;
  const negative = cleaned.startsWith('-');
  const body = cleaned.replace(/-/g, '');
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  let normalized: string;
  if (lastComma > lastDot) {
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else if (body.split('.').length > 2) {
    normalized = body.replace(/\./g, '');
  } else {
    normalized = body;
  }

  const num = parseFloat(normalized);
  if (!Number.isFinite(num)) return 0;
  return negative ? -num : num;
}

/** Làm tròn về QTY_MAX_DECIMALS chữ số thập phân (không để 2.1500000000000003). */
export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10 ** QTY_MAX_DECIMALS) / 10 ** QTY_MAX_DECIMALS;
}

/**
 * Chuẩn hoá số lượng trước khi lưu:
 * - luôn > 0 (server chặn v_qty <= 0)
 * - tối đa 3 chữ số thập phân
 * - mặt hàng không bật cờ thì ép về số nguyên
 */
export function snapQty(value: number, allowDecimal: boolean): number {
  const min = 1 / 10 ** QTY_MAX_DECIMALS;
  const safe = Number.isFinite(value) && value > 0 ? value : min;
  const rounded = roundQty(safe);
  if (allowDecimal) return Math.max(min, rounded);
  return Math.max(1, Math.round(rounded));
}

/** Bước tăng/giảm nhanh: hàng thập phân dùng bước 0,1 cho khỏi lệch quá xa. */
export function qtyStep(allowDecimal: boolean): number {
  return allowDecimal ? 0.1 : 1;
}

/** Hiển thị số lượng: bỏ phần thập phân thừa 0 (2.150 -> "2,15"). */
export function formatQty(value: number, allowDecimal = true): string {
  const rounded = roundQty(Number(value) || 0);
  if (!allowDecimal) return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(rounded));
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: QTY_MAX_DECIMALS }).format(rounded);
}
