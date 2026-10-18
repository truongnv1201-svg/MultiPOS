// Guard cho "Cân tồn nhanh tại POS": khi giỏ vượt tồn hệ thống, thay vì ngõ cụt
// "giảm SL hoặc nhập kho thêm", Admin/Quản lý sinh phiếu điều chỉnh TĂNG tồn (0064)
// ngay trong POS rồi chạy lại thanh toán.
//
// Vì sao test tĩnh: các hàm nằm trong React hook / component (không import trực tiếp
// bằng node). Khoá lại các quyết định nghiệp vụ, không được gãy âm thầm:
//   1. Công thức trừ kho dùng CHUNG 1 nguồn (lib/stock-shortage) — checkout + POS khớp nhau.
//   2. Chỉ TĂNG tồn đúng phần thiếu; KHÔNG hạ tồn, KHÔNG đụng sổ quỹ/giá vốn.
//   3. BẮT BUỘC user chọn lý do — máy không tự chốt (tự chốt là mất truy vết).
//   4. Chỉ Admin/Quản lý; cashier bị chặn + báo rõ; offline không cân được.
//   5. Phiếu phải ghi xong TRƯỚC khi chạy lại thanh toán (server chặn tồn âm, không hậu kiểm).
//
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('Cân tồn nhanh tại POS khi bán vượt tồn', () => {
  const helper = read('lib/stock-shortage.ts');
  const checkout = read('lib/store/tx/checkout.tsx');
  const pos = read('components/pos/POSScreen.tsx');
  const modal = read('components/pos/StockShortageModal.tsx');

  it('có module công thức dùng chung', () => {
    assert.ok(existsSync(join(ROOT, 'lib/stock-shortage.ts')), 'lib/stock-shortage.ts phải tồn tại');
  });

  it('helper mirror đúng công thức trừ kho (bỏ service, combo con, area m2*waste)', () => {
    assert.match(helper, /if \(item\.product_type === 'service'\) continue;/);
    assert.match(helper, /if \(item\.product_type === 'combo'\)[\s\S]{0,200}comboProduct\?\.combo_items/);
    assert.match(helper, /child\.quantity \* item\.quantity/);
    assert.match(helper, /item\.product_type === 'area' && item\.dimension_details/);
    assert.match(helper, /m2 \* \(1 \+ waste \/ 100\)/);
  });

  it('checkout KHÔNG tự build nhu cầu trừ kho nữa (dùng helper, tránh lệch 2 nơi)', () => {
    assert.match(checkout, /collectStockDeductions\(activeCart\.items, products\)/);
    assert.match(checkout, /findStockShortages\(activeCart\.items, products\)/);
    assert.ok(
      !/const stockDeductions: Record<string, number> = \{\};/.test(checkout),
      'checkout không được tự dựng lại bảng trừ kho (phải gọi helper chung)'
    );
    // Chốt chặn cuối vẫn phải còn (máy khác vừa bán hết kho trong lúc modal đang mở).
    assert.match(checkout, /Tồn kho không đủ, không thể bán:/);
    assert.match(checkout, /Hãy giảm SL hoặc nhập kho thêm\./);
  });

  it('POS: giỏ vượt tồn -> mở modal, chỉ khi online + có quyền Admin/Quản lý', () => {
    assert.match(pos, /const cartShortages = useMemo\(/);
    assert.match(pos, /flow === 'sale' \? findStockShortages\(activeCart\.items, products\) : \[\]/);
    assert.match(pos, /if \(cartShortages\.length > 0 && canOfferStockAdjust\) \{/);
    assert.match(pos, /if \(!canAdjustStock\) \{/);
    assert.match(pos, /if \(!isOnline\) \{/);
    assert.match(pos, /setStockShortages\(cartShortages\);/);
    // Thu nhân: chặn + báo nhờ quản lý, KHÔNG tự mở modal.
    assert.match(pos, /Việc cân tồn chỉ Admin\/Quản lý làm được/);
    assert.match(pos, /const canAdjustStock = authReady && \(!supabaseReady \|\| profile\?\.role === 'admin' \|\| profile\?\.role === 'manager'\);/);
    // Chế độ local-only (chưa cấu hình Supabase) không cân được -> không mời, rơi về guard cũ.
    assert.match(pos, /const canOfferStockAdjust = supabaseReady && canAdjustStock;/);
    // Cảnh báo sớm trong giỏ (không phải chờ tới bước thanh toán).
    assert.match(pos, /mặt hàng trong giỏ vượt tồn kho/);
  });

  it('BẮT BUỘC chọn lý do: không có lý do mặc định, chặn khi bỏ trống', () => {
    assert.match(modal, /useState<string>\(''\)/);
    assert.match(modal, /if \(!reason\) \{/);
    assert.match(modal, /Hãy chọn lý do điều chỉnh trước khi cân tồn kho\./);
    // Lý do lấy từ danh mục chuẩn của 0064, không tự bịa nhãn mới.
    assert.match(modal, /STOCK_ADJUST_REASON_LABEL/);
  });

  it('chỉ TĂNG tồn đúng phần thiếu (delta dương), không gửi countedStock', () => {
    assert.match(pos, /stockShortages\.map\(\(s\) => \(\{ productId: s\.productId, delta: s\.short \}\)\)/);
    assert.match(helper, /short: round3\(need - p\.stock_quantity\)/);
    assert.ok(!/countedStock/.test(pos), 'modal cân tồn không dùng countedStock (chỉ tăng phần thiếu)');
  });

  it('ghi phiếu XONG mới chạy lại thanh toán (server chặn tồn âm, không hậu kiểm)', () => {
    // Handler: await adjustStock -> chỉ khi thành công mới đóng modal + tăng token.
    assert.match(pos, /const res = await adjustStock\(/);
    assert.match(pos, /if \(!res\) return;\n\s+setStockShortages\(null\);\n\s+setCheckoutRetryToken\(\(t\) => t \+ 1\);/);
    // Chạy lại qua effect (sau khi products cập nhật), không gọi tuần tự ngay trong handler.
    assert.match(pos, /if \(checkoutRetryToken === 0\) return;\n\s+handleCheckoutRef\.current\(\);/);
  });

  it('modal KHÔNG đụng sổ quỹ / giá vốn (đã do adjustStock 0064 lo)', () => {
    assert.ok(!/setCashbook|cashbook/.test(modal), 'modal không được ghi sổ quỹ');
    assert.ok(!/avg_cost/.test(modal), 'modal không được sửa giá vốn');
  });

  it('có lối thoát đúng nghiệp vụ: hàng chưa nhập kho thì dùng Nhập kho (ghi giá vốn + công nợ)', () => {
    assert.match(modal, /chưa lập phiếu nhập kho/);
    assert.match(modal, /Nhập kho/);
  });
});
