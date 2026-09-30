// Test cho luồng ghi đè đơn giá POS (migration 0059 + lib/store/rpc.ts + PriceDraftInput).
// Chạy: npm test (node --test ...). Không cần mạng/DB — đọc file và assert logic thuần,
// để regression (bỏ chặn is_manager, gửi price_override cho mọi dòng, quên chốt giá) rớt CI.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toRpcItems } from '../lib/store/rpc.ts';
import { recomputeOrderItem } from '../lib/pricing.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const item = (over = {}) => ({
  id: 'item-1',
  product_id: 'p1',
  sku: 'SP000015',
  name: 'Keo 502',
  product_type: 'goods',
  unit: 'chai',
  unit_price: 20000,
  quantity: 1,
  discount_amount: 0,
  processing_fee: 0,
  subtotal: 20000,
  ...over,
});

describe('0059: server gate đơn giá ghi đè', () => {
  const sql = read('supabase/migrations/0059_pos_price_override.sql');

  it('tồn tại migration 0059', () => {
    assert.ok(sql.length > 0);
  });

  it('chỉ nhận price_override khi is_manager() (admin đã gồm trong is_manager)', () => {
    assert.match(sql, /IF NOT public\.is_manager\(\) THEN/);
    assert.match(sql, /Chỉ Quản lý\/Admin được sửa đơn giá/);
  });

  it('kẹp giá ghi đè trong [0, 100000000]', () => {
    assert.match(sql, /v_ovr < 0 OR v_ovr > 100000000/);
  });

  it('chỉ đánh dấu override khi giá khác giá danh mục', () => {
    assert.match(sql, /IF round\(v_ovr\) <> round\(v_price\) THEN/);
  });

  it('ghi audit ai sửa giá vào order_items', () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS price_override boolean/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS price_override_by text/);
    assert.match(sql, /v_overridden, v_override_by\)/);
  });

  it('giữ chữ ký 10-arg của 0050 (không phá call cũ)', () => {
    const args = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.pos_checkout('));
    assert.match(args, /p_client_ref TEXT DEFAULT NULL\n\) RETURNS JSONB/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.pos_checkout\(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT\) TO authenticated/);
  });
});

describe('0060: tín hiệu price_adjusted (không in hoá đơn sai giá)', () => {
  const sql = read('supabase/migrations/0060_checkout_price_adjusted_signal.sql');

  it('tồn tại migration 0060', () => {
    assert.ok(sql.length > 0);
  });

  it('so giá thực tế với giá client gửi cho từng dòng', () => {
    assert.match(sql, /v_sent_price := round\(COALESCE\(\(it->>'unit_price'\)::NUMERIC, v_price\)\)/);
    assert.match(sql, /IF round\(v_price\) <> v_sent_price THEN/);
  });

  it('trả về price_adjusted (rỗng = khớp màn hình)', () => {
    assert.match(sql, /'price_adjusted', v_price_adjusted\)/);
    assert.match(sql, /v_price_adjusted := '\[\]'::JSONB/);
  });

  it('giữ nguyên chốt quyền của 0059', () => {
    assert.match(sql, /IF NOT public\.is_manager\(\) THEN/);
  });
});

describe('client: cờ price_override không được phụ thuộc tra giá danh mục', () => {
  const pos = read('components/pos/POSScreen.tsx');

  it('bật cờ thẳng khi người dùng sửa giá (bug: tra trượt catalog là rơi cờ im lặng)', () => {
    assert.match(pos, /price_override: true/);
  });

  it('vẫn dùng giá danh mục (fallback SKU) chỉ để hiện nhãn "đã sửa"', () => {
    assert.match(pos, /products\.find\(\(x\) => x\.sku === item\.sku\)/);
  });

  it('không in phiếu khi server báo giá bị đổi', () => {
    const checkout = read('lib/store/tx/checkout.tsx');
    assert.match(checkout, /price_adjusted\?: \{ sku: string; name: string; sent_price: number; server_price: number \}\[]/);
    assert.match(checkout, /if \(priceAdjusted\.length > 0\) \{/);
    // nhánh lỗi phải return TRƯỚC chỗ mở phiếu in
    assert.ok(
      checkout.indexOf('if (priceAdjusted.length > 0)') <
        checkout.indexOf('setReceiptModalOrder(newOrder)'),
      'phải chặn in trước khi mở phiếu'
    );
  });
});

describe('toRpcItems: gửi price_override có chọn lọc', () => {
  it('dòng chưa sửa giá thì KHÔNG gửi price_override (y hệt 0050)', () => {
    const [it0] = toRpcItems([item()]);
    assert.equal('price_override' in it0, false);
    assert.equal(it0.unit_price, 20000);
  });

  it('dòng đã sửa giá thì gửi price_override làm tròn', () => {
    const [it0] = toRpcItems([item({ unit_price: 18500.4, price_override: true })]);
    assert.equal(it0.price_override, 18500);
  });

  it('cờ false thì vẫn không gửi (gõ lại đúng giá danh mục)', () => {
    const [it0] = toRpcItems([item({ price_override: false })]);
    assert.equal('price_override' in it0, false);
  });
});

describe('sửa đơn giá thì thành tiền + tổng chạy theo', () => {
  it('recomputeOrderItem tính lại subtotal theo giá mới', () => {
    const next = recomputeOrderItem(item({ unit_price: 18500, price_override: true, quantity: 2 }));
    assert.equal(next.subtotal, 37000);
  });

  it('giá 0 không được tạo ra từ ô nhập (PriceDraftInput giữ giá cũ)', () => {
    const src = read('components/pos/PriceDraftInput.tsx');
    assert.match(src, /if \(value > PRICE_MIN\) onCommit\(Math\.min\(PRICE_MAX, Math\.round\(value\)\)\)/);
    assert.match(src, /PRICE_MAX = 100_000_000/);
  });

  it('ô đơn giá và ô số lượng dùng CHUNG style ô sửa được', () => {
    const editable = read('components/common/EditableCell.tsx');
    assert.match(editable, /export const EDIT_CELL_CLASS/);
    assert.match(read('components/pos/PriceDraftInput.tsx'), /editCellClass\(/);
    assert.match(read('components/pos/QtyDraftInput.tsx'), /editCellClass\(/);
    // giỏ không còn nút +/-
    const pos = read('components/pos/POSScreen.tsx');
    assert.ok(!/title=\{`Tăng /.test(pos), 'không còn nút +/- trong giỏ');
  });
});
