import type { Product } from './types';

// Ngưỡng cảnh báo tồn ít dùng chung toàn app (single source of truth).
//
// Quy ước:
// - Mỗi mặt hàng có ngưỡng riêng ở `min_stock` (sửa trong form thêm/sửa hàng hóa
//   hoặc cột "Tồn tối thiểu" của file Excel).
// - `min_stock` trống / <= 0 (dữ liệu cũ, server default 0) = "chưa cấu hình" ->
//   rơi về DEFAULT_MIN_STOCK (15) để giữ đúng hành vi cảnh báo hiện tại.
// - Dịch vụ (service) không có tồn -> các hàm dưới vẫn tính theo số, caller tự
//   loại service ra khỏi bộ lọc/hiển thị như trước đây.
export const DEFAULT_MIN_STOCK = 15;

/** Ngưỡng tồn ít của 1 mặt hàng (luôn > 0). */
export function minStockOf(p: Pick<Product, 'min_stock'>): number {
  const v = Number(p.min_stock);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_STOCK;
}

/** true khi đã hết hàng (tồn <= 0). */
export function isOutOfStock(p: Pick<Product, 'stock_quantity'>): boolean {
  return Number(p.stock_quantity) <= 0;
}

/** true khi còn hàng nhưng đã chạm/ngã dưới ngưỡng tồn tối thiểu. */
export function isLowStock(p: Pick<Product, 'stock_quantity' | 'min_stock'>): boolean {
  if (isOutOfStock(p)) return false;
  return Number(p.stock_quantity) <= minStockOf(p);
}

export type StockStatus = 'out' | 'low' | 'ok';

/** Trạng thái tồn để lọc/sắp xếp/hiển thị badge. */
export function stockStatus(p: Pick<Product, 'stock_quantity' | 'min_stock'>): StockStatus {
  if (isOutOfStock(p)) return 'out';
  return isLowStock(p) ? 'low' : 'ok';
}
