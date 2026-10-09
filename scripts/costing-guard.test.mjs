// Guard toán VỐN & BIÊN LÃI (lib/costing.ts) — đối xứng pricing.ts.
//
// Khóa 2 công thức từng nằm rải rác 3 nơi (POSScreen preview, shift-stock
// offline, SQL 0042/0048/0053):
//   MAC: new_avg = round((tồn cũ*vốn cũ + sl*giá) / tồn mới), tồn mới 0 -> giá nhập.
//   Biên: amount = giá bán - vốn; pct trên giá bán (giá bán <= 0 -> 0).
// Đổi công thức ở đây = đọc LUẬT PARITY đầu file trước (đổi cả SQL + parity test).
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { previewImportAvg, lineMargin, historicalUnitCost } from '../lib/costing.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('previewImportAvg: khớp SQL 0042/0048/0053', () => {
  it('trung bình có trọng số, làm tròn nguyên', () => {
    // Tồn 100 vốn 20k + nhập 100 giá 30k -> (100*20000+100*30000)/200 = 25000
    const r = previewImportAvg(100, 20000, 100, 30000);
    assert.deepEqual(r, { oldStock: 100, oldAvg: 20000, newStock: 200, newAvg: 25000 });
  });

  it('hàng mới (tồn 0) -> vốn = giá nhập', () => {
    const r = previewImportAvg(0, 0, 50, 15000);
    assert.equal(r.newStock, 50);
    assert.equal(r.newAvg, 15000);
  });

  it('undefined/null coi như 0 (như coalesce SQL), khỏi NaN', () => {
    const r = previewImportAvg(undefined, undefined, 10, 5000);
    assert.deepEqual(r, { oldStock: 0, oldAvg: 0, newStock: 10, newAvg: 5000 });
  });

  it('nối tiếp nhiều dòng cùng hàng cho ra MAC cuối đúng', () => {
    let s = 0;
    let a = 0;
    for (const [qty, price] of [[10, 10000], [10, 20000]]) {
      const r = previewImportAvg(s, a, qty, price);
      s = r.newStock;
      a = r.newAvg;
    }
    // (0 + 10*10000)/10 = 10000; (10*10000 + 10*20000)/20 = 15000
    assert.equal(s, 20);
    assert.equal(a, 15000);
  });
});

describe('historicalUnitCost: von chup luc ban, fallback MAC', () => {
  const prods = [{ id: 'p1', avg_cost: 20000 }];

  it('don moi co snapshot -> dung snapshot (ke ca khi MAC da doi)', () => {
    assert.equal(historicalUnitCost({ unit_price: 30000, unit_cost: 18000 }, [{ id: 'p1', avg_cost: 25000 }], 'p1'), 18000);
  });

  it('don cu chua co snapshot -> MAC hien tai', () => {
    assert.equal(historicalUnitCost({ unit_price: 30000 }, prods, 'p1'), 20000);
    assert.equal(historicalUnitCost({ unit_price: 30000, unit_cost: 0 }, prods, 'p1'), 20000);
  });

  it('mat hang da xoa -> 0.7 gia ban (quy uoc cu)', () => {
    assert.equal(historicalUnitCost({ unit_price: 30000 }, prods, 'gone'), 21000);
  });
});

describe('lineMargin: biên lãi gộp', () => {
  it('bán 30k vốn 20k -> lãi 10k, 33.33%', () => {
    const m = lineMargin(30000, 20000);
    assert.equal(m.amount, 10000);
    assert.ok(Math.abs(m.pct - 33.333333333333336) < 1e-9);
  });

  it('giá bán 0 -> pct 0 (khỏi chia 0)', () => {
    assert.deepEqual(lineMargin(0, 5000), { amount: -5000, pct: 0 });
  });

  it('bán dưới vốn -> lãi âm (không kẹp về 0)', () => {
    const m = lineMargin(15000, 20000);
    assert.equal(m.amount, -5000);
    assert.ok(m.pct < 0);
  });

  it('thiếu số coi như 0', () => {
    assert.deepEqual(lineMargin(null, undefined), { amount: 0, pct: 0 });
  });
});

describe('costing: không còn công thức lẻ trong view/store', () => {
  it('POSScreen preview + shift-stock offline dùng previewImportAvg', () => {
    const pos = read('components/pos/POSScreen.tsx');
    assert.match(pos, /previewImportAvg\(cur\.stock, cur\.avg, line\.qty, line\.price\)/);
    assert.ok(!/oldStock \* oldAvg \+ qty \* price/.test(pos), 'POSScreen còn công thức MAC inline');
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /previewImportAvg\(cur\.stock_quantity, cur\.avg_cost, l\.quantity, l\.importPrice\)/);
    assert.ok(!/prevStock \* prevCost \+ l\.quantity \* l\.importPrice/.test(shift), 'shift-stock còn công thức MAC inline');
  });

  it('Báo cáo tính lãi kỳ từ dòng đơn (không biên tĩnh, không công thức inline)', () => {
    const rep = read('components/reports/ReportsView.tsx');
    assert.ok(!/lineMargin\(/.test(rep), 'ReportsView còn dùng biên tĩnh giá bán - vốn MAC');
    assert.ok(!/p\.retail_price - p\.avg_cost/.test(rep), 'ReportsView còn công thức biên inline');
    // Gom dòng đơn trong kỳ theo product_id + phân bổ CK bill
    assert.match(rep, /for \(const o of rangedOrders\)/);
    assert.match(rep, /discountShare/);
    assert.match(rep, /historicalUnitCost\(it, products, it\.product_id\)/);
  });

  it('đồng bộ đơn kéo vốn chụp về (pull select * đã gồm unit_cost)', () => {
    const sync = read('lib/store/tx/orders-sync.ts');
    assert.match(sync, /unit_cost: row\.unit_cost != null \? Number\(row\.unit_cost\) : undefined,/);
  });
});
