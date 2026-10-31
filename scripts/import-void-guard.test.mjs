// Guard hủy/sửa phiếu nhập (0087).
// Khóa những chỗ nếu sửa nhầm sẽ làm lệch tồn/kho/quỹ mà test thường không thấy:
//   - RPC đảo phải có ACL + NOTIFY + clamp tồn + loại thẻ kho riêng.
//   - Client phải giữ khóa gọi server (serverId/client_ref) và whitelist status cancelled.
//   - UI phải ẩn nút với phiếu cũ thiếu dòng, và không cộng phiếu hủy vào tổng nhập.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('migration 0087: đảo phiếu nhập', () => {
  const file = 'supabase/migrations/0087_void_stock_import.sql';
  const sql = read(file);

  it('có RPC void_stock_import + cột audit', () => {
    assert.ok(existsSync(join(ROOT, file)));
    assert.match(sql, /create or replace function public\.void_stock_import\(/);
    assert.match(sql, /add column if not exists cancelled_at timestamptz/);
    assert.match(sql, /add column if not exists cancel_reason text/);
  });

  it('gate quản lý + ACL + reload schema', () => {
    assert.match(sql, /if not public\.is_manager\(\) then/);
    assert.match(sql, /revoke all on function public\.void_stock_import\(text, uuid, text, text\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.void_stock_import\(text, uuid, text, text\) to authenticated;/);
    assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
  });

  it('đảo tồn/MAC đúng: clamp 0, vốn không bao giờ về 0', () => {
    assert.match(sql, /greatest\(v_stock - v_qty, 0\)/);
    assert.match(sql, /else v_net end/);
    assert.match(sql, /round\(\(v_stock \* v_avg - v_qty \* v_net\) \/ v_new_stock\)/);
    assert.match(sql, /movement_type\)\s*\n?\s*values[\s\S]*?'import_void'\)/);
  });

  it('nợ NCC clamp + hoàn tiền idempotent theo mã phiếu', () => {
    assert.match(sql, /greatest\(coalesce\(current_debt, 0\) - v_po\.debt_amount, 0\)/);
    assert.match(sql, /coalesce\(client_ref, ''\) not like 'void:%'/);
    assert.match(sql, /'void:' \|\| v_po\.code/);
    assert.match(sql, /exception when unique_violation/);
  });

  it('hủy 2 lần trả already_cancelled (không trừ kho lần 2)', () => {
    assert.match(sql, /if v_po\.status = 'cancelled' then[\s\S]*?already_cancelled/);
    assert.match(sql, /'missing_lines'/);
  });
});

describe('store: khóa gọi server + phân loại phiếu', () => {
  const shift = read('lib/store/tx/shift-stock.tsx');

  it('pull phiếu nhập giữ serverId/client_ref và trạng thái cancelled', () => {
    assert.match(shift, /serverId: String\(row\.id \|\| ''\)/);
    assert.match(shift, /client_ref: typeof row\.client_ref === 'string'/);
    assert.match(shift, /\['completed', 'cancelled', 'debt', 'partial'\]/);
    assert.match(shift, /serverId: s\.serverId,/);
  });

  it('bản ghi local giữ client_ref ngay khi lập phiếu', () => {
    assert.match(shift, /const clientRef = `imp-\$\{Date\.now\(\)\}/);
    assert.match(shift, /client_ref: clientRef,/);
    assert.match(shift, /clientRef,\n\s+code: refCode,/);
  });

  it('voidImportSlip: cần ca mở, đẩy hàng đợi trước, RPC-first, local-only khi chưa sync', () => {
    assert.match(shift, /const voidImportSlip = useCallback\(/);
    assert.match(shift, /Ca làm việc chưa mở hoặc đã đóng! Vui lòng mở ca mới \(F12\) trước khi hủy phiếu\./);
    assert.match(shift, /await syncPendingOpsRef\.current\(\);/);
    assert.match(shift, /supa\.rpc\('void_stock_import'/);
    assert.match(shift, /Phiếu còn thao tác chờ đồng bộ/);
    assert.match(shift, /db\.pendingOps\.delete\(op\.id\)/);
    assert.match(shift, /movement_type: 'import_void'/);
  });

  it('store composer expose voidImportSlip', () => {
    assert.match(read('lib/store/tx/shift-stock.tsx'), /voidImportSlip,/);
    assert.match(read('lib/store/transactions.tsx'), /voidImportSlip: shiftStock\.voidImportSlip/);
    assert.match(read('lib/store.tsx'), /voidImportSlip,/);
  });
});

describe('UI: nút hủy/sửa phiếu + prefill panel nhập', () => {
  const view = read('components/imports/ImportsView.tsx');

  it('nút Hủy/Sửa gọi voidImportSlip, chặn phiếu cũ thiếu dòng', () => {
    assert.match(view, /voidImportSlip/);
    assert.match(view, /handleVoidSlip/);
    assert.match(view, /Sửa phiếu/);
    assert.match(view, /Hủy phiếu/);
    assert.match(view, /po\.items\.length === 0/);
    assert.match(view, /setImportPrefill\(/);
  });

  it('tổng nhập/nợ bỏ phiếu đã hủy', () => {
    assert.match(view, /if \(cur\.status === 'cancelled'\) return acc;/);
    assert.match(view, /if \(p\.status === 'cancelled'\) continue;/);
  });

  it('POSScreen tiêu thụ prefill rồi xóa (không dính sang phiếu sau)', () => {
    const pos = read('components/pos/POSScreen.tsx');
    assert.match(pos, /importPrefill/);
    assert.match(pos, /setImportPrefill\(null\)/);
    assert.match(pos, /flow !== 'import' \|\| products\.length === 0/);
  });

  it('thẻ kho có loại "Hủy phiếu nhập"', () => {
    const inv = read('components/inventory/InventoryView.tsx');
    assert.match(inv, /import_void: 'Hủy phiếu nhập'/);
    assert.match(inv, /type === 'import_void'/);
  });

  it('types mở rộng movement_type + PurchaseOrder + ImportPrefill', () => {
    const types = read('lib/types.ts');
    assert.match(types, /'import_void'/);
    assert.match(types, /serverId\?: string;/);
    assert.match(types, /client_ref\?: string;/);
    assert.match(types, /export interface ImportPrefill/);
  });
});
