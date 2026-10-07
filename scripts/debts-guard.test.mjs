// Guard trang Quản lý Công nợ (debts) — gộp thu nợ KH + trả nợ NCC:
// màn hình đăng ký đủ (type/page/menu/phím tắt legacy), shell 1 header + 2 tab,
// inner bare (ẩn header, TableTools xuống filter, modal mở qua prop).
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('cong no: man hinh dang ky du', () => {
  it('ActiveScreen + page + menu + phim tat legacy (Alt+C/K mo dung tab)', () => {
    assert.ok(existsSync(join(ROOT, 'components/debts/DebtsView.tsx')));
    const types = read('lib/types.ts');
    assert.match(types, /\| 'debts'/);
    const page = read('app/page.tsx');
    assert.match(page, /{effectiveScreen === 'debts' && <DebtsView \/>}/);
    assert.match(page, /{effectiveScreen === 'customers' && <DebtsView initialTab="customers" \/>}/);
    assert.match(page, /{effectiveScreen === 'suppliers' && <DebtsView initialTab="suppliers" \/>}/);
    const menu = read('components/FlyoutMenu.tsx');
    assert.match(menu, /screen: 'debts' as const, label: 'Quản lý Công nợ'/);
    assert.ok(!/screen: 'customers'/.test(menu), 'menu không còn mục KH riêng');
    assert.ok(!/screen: 'suppliers'/.test(menu), 'menu không còn mục NCC riêng');
    const header = read('components/GlobalHeader.tsx');
    assert.match(header, /go\('customers'\)/);
    assert.match(header, /go\('suppliers'\)/);
  });

  it('shell 1 header + 2 tab, inner bare (an header, TableTools xuong filter)', () => {
    const shell = read('components/debts/DebtsView.tsx');
    assert.equal((shell.match(/<PageHeader/g) || []).length, 1, 'DebtsView đúng 1 PageHeader');
    assert.match(shell, /<TabSwitcher<DebtsTab>/);
    assert.match(shell, /id: 'debts-tab-customers'/);
    assert.match(shell, /id: 'debts-tab-suppliers'/);
    assert.match(shell, /<CustomersView bare addOpen=\{custAddOpen}/);
    assert.match(shell, /<SuppliersView bare addOpen=\{supAddOpen}/);
    for (const f of [
      'components/customers/CustomersView.tsx',
      'components/suppliers/SuppliersView.tsx',
    ]) {
      const src = read(f);
      assert.match(src, /\{!bare && \(\s*(<PageHeader|<div className="h-14|{\/\*)/, `${f} ẩn header khi bare`);
      assert.match(src, /\{bare && \(?\s*(<>)?\s*<TableTools/, `${f} đưa TableTools xuống filter khi bare`);
    }
  });

  it('nut tao mo modal qua prop (khong tach state ra khoi view)', () => {
    const cus = read('components/customers/CustomersView.tsx');
    assert.match(cus, /const isAddModalOpen = addOpen \?\? internalAddOpen;/);
    const sup = read('components/suppliers/SuppliersView.tsx');
    assert.match(sup, /const isAddModalOpen = addOpen \?\? internalAddOpen;/);
  });
});
