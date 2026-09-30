// Test tĩnh cho phép kéo delta đơn hàng (lib/store/tx/orders-sync.ts + migrations).
// Đo thực tế trước khi sửa: mỗi lần bán kéo lại ~180 KB cho orders + order_items vì
// luôn kéo cửa sổ 90 ngày. Nay chỉ kéo phần thay đổi theo updated_at.
// Ràng buộc quan trọng nhất: đơn hàng KHÔNG append-only (đặt cọc -> hoàn thành -> hủy ->
// trả hàng), nên watermark phải là updated_at và DB phải tự bump cột này — nếu không,
// thay đổi trên đơn cũ sẽ bị bỏ sót mà không có dấu hiệu gì.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const sync = read('lib/store/tx/orders-sync.ts');
const store = read('lib/store.tsx');
const trig = read('supabase/migrations/0057_orders_updated_at_trigger.sql');
const idx = read('supabase/migrations/0058_orders_updated_at_index.sql');

describe('kéo delta đơn hàng: đúng dữ liệu, nhẹ lưu lượng', () => {
  it('delta dùng updated_at chứ không phải created_at', () => {
    assert.match(sync, /\.gte\('updated_at', fromIso!\)/);
    assert.match(sync, /order\('updated_at', \{ ascending: false \}\)/);
    // Đường kéo toàn bộ vẫn dùng created_at + cửa sổ 90 ngày như cũ.
    assert.match(sync, /\.gte\('created_at', cutoffIso\)/);
  });

  it('chỉ kéo delta sau lần kéo đầu, có chồng 2s chống trùng giây, trần 500 dòng', () => {
    assert.match(sync, /const incremental = ordersLoadedRef\.current && !force && ordersWatermarkRef\.current;/);
    assert.match(sync, /ORDERS_OVERLAP_MS = 2000/);
    assert.match(sync, /ORDERS_DELTA_LIMIT = 500/);
    assert.match(sync, /\.limit\(ORDERS_DELTA_LIMIT\)/);
  });

  it('delta hợp nhất theo server_id, không thay cả danh sách, và giữ items cũ', () => {
    assert.match(sync, /const byServerId = new Map\(previous\.filter\(\(o\) => o\.server_id\)/);
    assert.match(sync, /order\.items\.length === 0 && prev\?\.items\.length \? \{ \.\.\.order, items: prev\.items \} : order/);
    // Đơn offline chưa đẩy vẫn phải được giữ lại ở cả hai đường.
    assert.match(sync, /const pendingLocal = previous\.filter\(\(order\) => order\.is_offline && !order\.server_id\);/);
    assert.match(sync, /if \(!incremental\) return stableNext\(previous, \[\.\.\.pendingLocal, \.\.\.mapped\]\);/);
    // Thứ tự phải giống đường kéo toàn bộ (created_at desc) để phân trang không bị lệch.
    assert.match(sync, /sort\(\(a, b\) => b\.created_at\.localeCompare\(a\.created_at\)\)/);
  });

  it('delta chạm trần thì bỏ watermark để lần sau kéo toàn bộ', () => {
    assert.match(sync, /const hitLimit = serverOrders\.length >= ORDERS_DELTA_LIMIT;/);
    assert.match(sync, /if \(newestUpdated && !hitLimit\) ordersWatermarkRef\.current = newestUpdated;/);
    assert.match(sync, /else if \(hitLimit\) ordersWatermarkRef\.current = null;/);
  });

  it('items của đơn trong delta cũng được kéo theo lô 200 id', () => {
    assert.match(sync, /for \(let i = 0; i < orderIds\.length; i \+= SERVER_ITEMS_BATCH_SIZE\)/);
  });

  it('đăng nhập / hydrate / vào lại mạng -> force kéo toàn bộ', () => {
    assert.equal((store.match(/refreshServerOrders\(true\)/g) || []).length, 2);
    // Poll + realtime thì gọi không tham số -> delta.
    assert.match(store, /refreshServerOrders\(\),/);
  });

  it('DB tự bump updated_at khi đơn thay đổi (không phụ thuộc kỷ luật của RPC)', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0057_orders_updated_at_trigger.sql')));
    assert.match(trig, /BEFORE UPDATE ON public\.orders/);
    assert.match(trig, /NEW\.updated_at := now\(\);/);
    assert.match(trig, /DROP TRIGGER IF EXISTS trg_orders_touch_updated_at/);
  });

  it('có index updated_at cho truy vấn delta', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0058_orders_updated_at_index.sql')));
    assert.match(idx, /CREATE INDEX IF NOT EXISTS idx_orders_updated ON public\.orders \(updated_at DESC\);/);
  });
});
