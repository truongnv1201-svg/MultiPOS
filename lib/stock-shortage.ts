// Cân tồn nhanh tại POS — công thức "cần trừ bao nhiêu kho cho 1 giỏ hàng".
//
// Vì sao tách riêng: cùng một công thức được dùng ở HAI chỗ, không được nhân bản:
//   1. Guard chặn bán lố trong checkout (offline lẫn online) — lib/store/tx/checkout.tsx
//   2. Modal cân tồn nhanh ở POS (sinh phiếu điều chỉnh 0064 rồi bán tiếp) — POSScreen
// Nhân bản công thức combo con / area m2*waste là mầm lệch: sửa 1 chỗ quên chỗ kia thì
// modal "cân vừa đủ" nhưng checkout vẫn chặn (hoặc ngược lại, cân thừa kho).
import type { OrderItem, Product } from './types';

/** 1 mặt hàng trong giỏ vượt tồn hệ thống. */
export interface StockShortage {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  /** tồn hệ thống hiện tại */
  have: number;
  /** lượng cần trừ kho cho giỏ này */
  need: number;
  /** phần thiếu = need - have (> 0) */
  short: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Gộp nhu cầu trừ kho của cả giỏ theo product_id.
 * - Bỏ dịch vụ (không giữ tồn).
 * - Combo: trừ kho của các con (combo cha không giữ tồn — INV-ERR-02).
 * - Hàng area: theo m2 thực x hệ số hao hụt hiện tại (mirror server 0028), KHÔNG tin
 *   material_consumed cũ trong giỏ.
 */
export function collectStockDeductions(items: OrderItem[], products: Product[]): Record<string, number> {
  const deductions: Record<string, number> = {};
  for (const item of items) {
    if (item.product_type === 'service') continue;

    if (item.product_type === 'combo') {
      const comboProduct = products.find((p) => p.id === item.product_id);
      if (comboProduct?.combo_items) {
        for (const child of comboProduct.combo_items) {
          const needed = child.quantity * item.quantity;
          deductions[child.product_id] = (deductions[child.product_id] || 0) + needed;
        }
      }
      continue;
    }

    if (item.product_type === 'area' && item.dimension_details && item.dimension_details.length > 0) {
      const prod = products.find((p) => p.id === item.product_id);
      const waste = prod?.waste_factor ?? item.waste_factor ?? 0;
      const m2 = item.dimension_details.reduce((s, d) => s + (d.actual_m2 || 0), 0);
      const need = round3(m2 * (1 + waste / 100));
      deductions[item.product_id] = (deductions[item.product_id] || 0) + need;
    } else {
      deductions[item.product_id] = (deductions[item.product_id] || 0) + item.quantity;
    }
  }
  return deductions;
}

/** Các mặt hàng trong giỏ vượt tồn hệ thống (đã gộp combo con / area). */
export function findStockShortages(items: OrderItem[], products: Product[]): StockShortage[] {
  const deductions = collectStockDeductions(items, products);
  const out: StockShortage[] = [];
  for (const [productId, need] of Object.entries(deductions)) {
    const p = products.find((x) => x.id === productId);
    if (p && p.stock_quantity < need) {
      out.push({
        productId,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        have: p.stock_quantity,
        need,
        short: round3(need - p.stock_quantity),
      });
    }
  }
  return out;
}

/** Dòng mô tả ngắn cho toast guard (giữ nguyên định dạng cũ của checkout). */
export function formatShortageLine(s: StockShortage): string {
  return `${s.sku} (tồn ${s.have}, cần ${s.need})`;
}
