// Guard mặc định lọc thời gian: mọi bảng nghiệp vụ mở lên là "Tuần này"
// (từ 00:00 Thứ 2 đến hiện tại — đủ nhìn tuần làm việc, khỏi bấm lại mỗi lần
// mở trang). Ai đổi mặc định ở 1 trang sẽ rớt test này.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('loc thoi gian: mac dinh Tuan nay', () => {
  it('6 bang nghiep vu dung preset this_week', () => {
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
      assert.match(src, /useState<DateFilterState>\(\{ preset: 'this_week' \}\)/, `${f} mặc định Tuần này`);
    }
    assert.ok(!/useState<DateFilterState>\(\{ preset: '(today|all|7days)' \}\)/.test(
      files.map(read).join('\n')
    ), 'không còn mặc định Hôm nay/Toàn thời gian/7 ngày trượt');
  });

  it("preset this_week tinh tu 00:00 Thu 2 (Mon=0, tuan VN bat dau Thu 2)", () => {
    const src = read('components/common/DateFilter.tsx');
    assert.match(src, /if \(filter\.preset === 'this_week'\)/);
    assert.match(src, /\(\(now\.getDay\(\) \+ 6\) % 7\)/);
    assert.match(src, /startOfWeek\.setHours\(0, 0, 0, 0\)/);
    assert.match(src, /<option value="this_week">Tuần này<\/option>/);
  });
});
