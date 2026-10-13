// Guard test tĩnh khóa bản vá bảo mật 0083 (2026-10-13):
// - 3 RPC tiền/nợ (cancel_order, return_order_items, collect_debt) phải có guard
//   vai trò is_counter_staff() = thu ngân trở lên (chặn worker), giữ nguyên thân
//   nghiệp vụ cũ + ACL revoke PUBLIC/anon (bài học 0068/0077).
// - Xóa khách hàng thu về Quản lý trở lên (thay policy mở của 0044).
// - UI ẩn nút theo vai trò khớp guard server; audit ACL + npm script còn nguyên.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('0083: siet quyen theo vai tro (RPC tien/no + xoa KH)', () => {
  const sql = read('supabase/migrations/0083_role_guards.sql');
  // Bỏ comment để assert chỉ soi code thực thi (header có nhắc chữ DROP/worker)
  const code = sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');

  it('tồn tại migration 0083', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0083_role_guards.sql')), 'thiếu 0083');
  });

  it('helper is_counter_staff = admin/manager/cashier (worker ngoài danh sách)', () => {
    assert.match(code, /create or replace function public\.is_counter_staff\(\)/);
    assert.match(code, /role in \('admin', 'manager', 'cashier'\)/);
    assert.match(code, /revoke all on function public\.is_counter_staff\(\) from public, anon;/);
    assert.match(code, /grant execute on function public\.is_counter_staff\(\) to authenticated;/);
  });

  it('3 RPC tiền/nợ đều có guard vai trò ở đầu hàm', () => {
    const guards = code.match(/if not public\.is_counter_staff\(\) then/gi) || [];
    assert.equal(guards.length, 3, 'phải đủ 3 guard cho cancel_order/return_order_items/collect_debt');
    for (const msg of [
      'Chỉ Thu ngân/Quản lý được hủy đơn',
      'Chỉ Thu ngân/Quản lý được trả hàng',
      'Chỉ Thu ngân/Quản lý được thu nợ',
    ]) {
      assert.ok(code.includes(msg), `thiếu thông báo: ${msg}`);
    }
  });

  it('thân hàm giữ nguyên nghiệp vụ (CREATE OR REPLACE, không DROP)', () => {
    assert.ok(!/drop function/i.test(code), 'không được DROP (mất ACL revoke PUBLIC)');
    assert.match(code, /CREATE OR REPLACE FUNCTION public\.cancel_order\(p_order_id UUID\)/);
    assert.match(code, /CREATE OR REPLACE FUNCTION public\.return_order_items\(/);
    assert.match(code, /create or replace function public\.collect_debt\(p_customer_id uuid/);
    // Các chốt nghiệp vụ cũ phải còn (copy từ 0069/0004)
    assert.match(code, /GREATEST\(v_sold - v_returned, 0\)/);
    assert.match(code, /partial_returned/);
    assert.match(code, /least\(p_amount, v_debt\)/);
    assert.match(code, /Hoàn kho hủy combo/);
  });

  it('chốt lại ACL PUBLIC/anon cho 3 RPC (bài học 0068/0077)', () => {
    for (const sig of [
      'cancel_order\\(UUID\\)',
      'return_order_items\\(UUID, NUMERIC, JSONB\\)',
      'collect_debt\\(UUID, NUMERIC, TEXT, TEXT\\)',
    ]) {
      assert.match(code, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${sig} FROM PUBLIC;`));
      assert.match(code, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${sig} FROM anon;`));
      assert.match(code, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`));
    }
  });

  it('xóa khách hàng = Quản lý trở lên (thay policy mở của 0044)', () => {
    assert.match(code, /drop policy if exists "catalog_authenticated_delete_customers" on public\.customers;/);
    assert.match(code, /create policy "catalog_manager_delete_customers" on public\.customers/);
    assert.match(code, /using \(public\.is_manager\(\)\)/);
  });

  it('UI ẩn nút theo vai trò khớp guard server', () => {
    const orders = read('components/orders/OrdersView.tsx');
    assert.match(orders, /const canMoneyOps =/);
    assert.match(
      orders,
      /!profile \|\| profile\.role === 'admin' \|\| profile\.role === 'manager' \|\| profile\.role === 'cashier'/
    );
    assert.match(orders, /\{canMoneyOps && \(/);
    const cus = read('components/customers/CustomersView.tsx');
    assert.match(cus, /const canCollectDebt = !profile \|\| profile\.role !== 'worker';/);
    assert.match(cus, /const canDeleteCustomer = !profile \|\| profile\.role === 'admin' \|\| profile\.role === 'manager';/);
    assert.match(cus, /\{canDeleteCustomer && \(/);
    assert.match(cus, /\{canCollectDebt &&/);
  });

  it('audit ACL definer + npm script sẵn sàng', () => {
    assert.ok(existsSync(join(ROOT, 'scripts/audit-rpc-acl.mjs')), 'thiếu audit script');
    const audit = read('scripts/audit-rpc-acl.mjs');
    assert.match(audit, /prosecdef = true/);
    assert.match(audit, /has_function_privilege\('anon'/);
    assert.match(audit, /ALLOW_ANON/);
    const pkg = read('package.json');
    assert.match(pkg, /"audit:acl": "node scripts\/audit-rpc-acl\.mjs"/);
    assert.match(pkg, /scripts\/rpc-acl-guard\.test\.mjs/);
  });
});
