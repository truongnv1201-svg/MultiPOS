// Guard cho đợt fixbug rà soát toàn bộ: giỏ chặn SL bẩn, khóa idempotency ổn định
// theo tab, thống kê ca đúng kênh tiền, reset dọn cả hàng đợi offline.
//
// Vì sao test tĩnh: các hàm nằm trong React hook (không import trực tiếp bằng node),
// nên khóa bằng assert trên source — cùng pattern với các guard *.test.mjs khác.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('giỏ chặn SL bẩn (âm/0/NaN) trước khi trừ tồn', () => {
  const cart = read('lib/store/tx/cart.tsx');

  it('addItemToCart từ chối SL không dương ngay cửa vào', () => {
    assert.match(cart, /if \(\!\(quantity > 0\)\) return;/);
  });

  it('gộp dòng trùng mà SL gộp <= 0 thì gỡ dòng (không giữ dòng âm kho)', () => {
    assert.match(cart, /if \(\!\(newQty > 0\)\) \{[\s\S]{0,200}filter\(\(_, i\) => i !== existingIndex\)/);
  });

  it('updateCartItem bỏ qua SL bẩn nhưng vẫn áp update khác (sửa giá không kẹt)', () => {
    assert.match(cart, /const \{ quantity, \.\.\.rest \} = updates;/);
    assert.match(cart, /quantity !== undefined && \!\(quantity > 0\) \? rest : updates/);
  });
});

describe('khóa idempotency ổn định theo tab (chống trùng đơn khi retry)', () => {
  const cart = read('lib/store/tx/cart.tsx');
  const checkout = read('lib/store/tx/checkout.tsx');
  const types = read('lib/store/types.ts');

  it('CartTab có trường client_ref', () => {
    assert.match(types, /client_ref\?: string;/);
  });

  it('checkout tái dùng khóa của tab, chỉ sinh mới khi chưa có', () => {
    assert.match(checkout, /activeCart\.client_ref \|\| `ord-/);
    assert.match(checkout, /if \(\!activeCart\.client_ref\) updateActiveTab\(\{ client_ref: clientRef \}\);/);
  });

  it('đổi món/xóa món/xóa giỏ thì xoay/xóa khóa (khóa cũ hết khớp nội dung)', () => {
    const hits = cart.match(/client_ref: undefined/g) || [];
    assert.ok(hits.length >= 4, `cần >= 4 chỗ xoay khóa, thấy ${hits.length}`);
  });

  it('luồng updateActiveTab tới được checkout (qua TxOrdersDeps)', () => {
    assert.match(read('lib/store/tx/orders-types.ts'), /updateActiveTab: \(updater: Partial<CartTab>\) => void;/);
    assert.match(read('lib/store/transactions.tsx'), /updateActiveTab: cart\.updateActiveTab,/);
  });
});

describe('thống kê ca đúng kênh tiền', () => {
  const checkout = read('lib/store/tx/checkout.tsx');

  it('cọc chuyển khoản KHÔNG vào doanh thu transfer_sales', () => {
    assert.match(checkout, /transfer_sales: \!isCash && \!isDeposit \? prev\.transfer_sales \+ paidAmount/);
  });

  it('cọc mọi kênh đều vào deposit_collected', () => {
    assert.match(checkout, /deposit_collected: isDeposit \? prev\.deposit_collected \+ paidAmount/);
  });
});

describe('reset dọn cả hàng đợi offline', () => {
  const store = read('lib/store.tsx');

  it('resetData xóa pendingOps + pendingMasterData (khỏi replay thao tác mồ côi)', () => {
    assert.match(store, /await db\.pendingOps\.clear\(\)/);
    assert.match(store, /await db\.pendingMasterData\.clear\(\)/);
  });
});
