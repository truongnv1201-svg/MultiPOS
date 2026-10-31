// Guard mặc định lọc thời gian: mọi bảng nghiệp vụ mở lên là "7 ngày qua"
// (từ 00:00 hôm nay-6 ngày đến hiện tại — trượt theo ngày, khỏi bấm lại mỗi lần
// mở trang). Ai đổi mặc định ở 1 trang sẽ rớt test này.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('loc thoi gian: mac dinh 7 ngay qua', () => {
  it('6 bang nghiep vu dung preset last_7_days', () => {
    const files = [
      'components/orders/OrdersView.tsx',
      'components/imports/ImportsView.tsx',
      'components/vouchers/ExportsTab.tsx',
      'components/cashbook/CashbookView.tsx',
      'components/reports/ReportsView.tsx',
      'components/inventory/InventoryView.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      assert.match(src, /useState<DateFilterState>\(\{ preset: 'last_7_days' \}\)/, `${f} mặc định 7 ngày qua`);
    }
    assert.ok(!/useState<DateFilterState>\(\{ preset: '(today|all|this_week)' \}\)/.test(
      files.map(read).join('\n')
    ), 'không còn mặc định Hôm nay/Toàn thời gian/Tuần này');
  });

  it('preset last_7_days tinh tu 00:00 (hom nay - 6 ngay)', () => {
    const src = read('components/common/DateFilter.tsx');
    assert.match(src, /if \(filter\.preset === 'last_7_days'\)/);
    assert.match(src, /startOfRange\.setDate\(now\.getDate\(\) - 6\)/);
    assert.match(src, /startOfRange\.setHours\(0, 0, 0, 0\)/);
    assert.match(src, /\{ value: 'last_7_days', label: '7 ngày qua' \}/);
    assert.ok(!/this_week/.test(src), 'không còn preset tuần lịch');
  });

  it('tuy chinh ngay nam trong listbox (khong nut lich roi ben ngoai)', () => {
    const src = read('components/common/DateFilter.tsx');
    assert.match(src, /\{ value: 'custom', label: 'Tùy chỉnh ngày…' \}/);
    assert.ok(!/<Calendar className="w-3\.5/.test(src), 'bỏ icon lịch rời cạnh dropdown');
    assert.match(src, /<Calendar className="w-4 h-4 text-blue-600" \/>/);
    assert.match(src, /Chọn khoảng ngày/);
  });
});
