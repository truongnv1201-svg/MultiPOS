// Guard mặc định lọc thời gian: mọi bảng nghiệp vụ mở lên là "7 ngày qua"
// (đủ nhìn tuần làm việc, khỏi bấm lại mỗi lần mở trang). Ai đổi mặc định
// về 'today'/'all' ở 1 trang sẽ rớt test này.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('loc thoi gian: mac dinh 7 ngay qua', () => {
  it('6 bang nghiep vu dung preset 7days', () => {
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
      assert.match(src, /useState<DateFilterState>\(\{ preset: '7days' \}\)/, `${f} mặc định 7 ngày qua`);
    }
    assert.ok(!/useState<DateFilterState>\(\{ preset: '(today|all)' \}\)/.test(
      files.map(read).join('\n')
    ), 'không còn mặc định Hôm nay/Toàn thời gian');
  });

  it('preset 7days tinh tu 00:00 cach day 7 ngay (bao gom hom nay)', () => {
    const src = read('components/common/DateFilter.tsx');
    assert.match(src, /if \(filter\.preset === '7days'\)/);
    assert.match(src, /sevenDaysAgo\.setDate\(now\.getDate\(\) - 7\)/);
    assert.match(src, /sevenDaysAgo\.setHours\(0, 0, 0, 0\)/);
  });
});
