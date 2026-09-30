// Guard cho 0064 — điều chỉnh tồn kho / hao hụt.
//
// Vì sao cần file test riêng: 0064 đụng vào TIỀN và vào P&L công trình. Ba quyết định
// nghiệp vụ đã chốt với chủ app phải được khoá lại bằng assert, không được gãy âm thầm:
//   1. KHÔNG ghi hao hụt vào sổ quỹ (tiền đã ghi Chi lúc nhập kho -> ghi thêm là 2 lần).
//   2. Không điều chỉnh avg_cost (giá vốn đã chốt lúc nhập; hao mòn không tạo giá vốn mới).
//   3. Dòng hao hụt trong sổ vật tư công trình cộng vào chi phí nhưng KHÔNG trừ tồn lần 2.
// Cộng thêm: chỉ Admin/Quản lý, chặn âm kho, chặn SKU lặp, chặn anon (0063 đã dính lỗi này).
//
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const SQL_FILE = 'supabase/migrations/0064_stock_adjustment_rpc.sql';

describe('0064: điều chỉnh tồn / hao hụt', () => {
  it('tồn tại file migration', () => {
    assert.ok(existsSync(join(ROOT, SQL_FILE)), SQL_FILE + ' phải tồn tại');
  });

  const sql = read(SQL_FILE);
  const projects = read('lib/store/tx/projects.tsx');
  const types = read('lib/types.ts');
  const shiftStock = read('lib/store/tx/shift-stock.tsx');
  const reports = read('components/reports/ReportsView.tsx');
  const adjustTable = read('components/inventory/StockAdjustTable.tsx');

  it('1) HAO HỤT KHÔNG ĐỤNG SỔ QUỸ (tiền đã ghi Chi lúc nhập kho — ghi thêm là 2 lần)', () => {
    // Hàm adjustStock trong store không được chạm cashbook.
    const adjustBody = projects.match(/const adjustStock = useCallback\([\s\S]*?\n  \);/);
    assert.ok(adjustBody, 'phải tìm được thân adjustStock');
    assert.ok(!/setCashbook|cashbook/.test(adjustBody[0]), 'adjustStock KHÔNG được ghi sổ quỹ');
    // Báo cáo cũng không được cộng hao hụt vào chi/dòng tiền.
    assert.ok(!/expense\s*\+=\s*loss/.test(reports), 'không cộng hao hụt vào expense của donut Thu/Chi');
  });

  it('2) KHÔNG đổi avg_cost khi điều chỉnh tồn', () => {
    // Server chỉ update stock_quantity, không update avg_cost.
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn, 'phải tìm được thân hàm adjust_stock');
    assert.ok(
      !/UPDATE public\.products SET[^;]*avg_cost/i.test(fn[0]),
      'adjust_stock KHÔNG được sửa avg_cost (giá vốn đã chốt lúc nhập kho)'
    );
    // Client cũng chỉ ghi stock_quantity.
    const client = projects.match(/db\.products\.update\(x\.id, \{ stock_quantity: ns \}\)/);
    assert.ok(client, 'client chỉ cập nhật stock_quantity');
  });

  it('3) dòng hao hụt trong sổ công trình CỘNG chi phí nhưng KHÔNG trừ tồn lần 2', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    // Trừ tồn đúng 1 lần: chỉ có 1 UPDATE products trong hàm.
    const productUpdates = fn[0].match(/UPDATE public\.products SET stock_quantity/g) || [];
    assert.equal(productUpdates.length, 1, 'chỉ được trừ tồn đúng 1 lần trong adjust_stock');
    // Dòng hao hụt ghi vào project_materials KHÔNG kèm trừ kho.
    const wasteInsert = fn[0].match(/INSERT INTO public\.project_materials[\s\S]*?RETURNING/);
    assert.ok(!wasteInsert, 'đoạn insert dòng hao hụt không được chứa RETURNING/trừ kho');
    // P&L công trình cộng hết dòng -> dòng is_adjust tự động làm giảm lợi nhuận.
    assert.match(projects, /material_cost_total = p\.materials\.reduce\(\(s, m\) => s \+ \(m\.total_cost \|\| 0\), 0\)/);
    // Dòng điều chỉnh phải được đánh dấu để không ai hiểu nhầm là xuất bình thường.
    assert.match(types, /is_adjust\?: boolean;/);
    assert.match(sql, /is_adjust boolean not null default false/);
  });

  it('chỉ Admin/Quản lý được điều chỉnh (server chặn lần 2 bằng is_manager)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /IF NOT public\.is_manager\(\) THEN/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.assign_adjust_project\([\s\S]*?IF NOT public\.is_manager\(\) THEN/);
  });

  it('chặn anon/PUBLIC (0063 đã dính lỗi: chỉ revoke anon là KHÔNG đủ)', () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.adjust_stock\(TEXT, JSONB\) FROM PUBLIC;/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.adjust_stock\(TEXT, JSONB\) FROM anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.adjust_stock\(TEXT, JSONB\) TO authenticated;/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.assign_adjust_project\(UUID, UUID\) FROM PUBLIC;/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.assign_adjust_project\(UUID, UUID\) FROM anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.assign_adjust_project\(UUID, UUID\) TO authenticated;/);
  });

  it('chặn tồn âm + khoá dòng kho trước khi ghi (chống 2 phiếu song song lệch tồn)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /FOR UPDATE/);
    assert.match(fn[0], /IF v_new < 0 THEN/);
    assert.match(fn[0], /điều chỉnh sẽ làm tồn âm/);
  });

  it('bắt buộc có lý do (không lý do thì không ai truy được về sau)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /IF v_reason = '' THEN/);
    assert.match(sql, /reason text not null/);
  });

  it('chặn SKU lặp trong 1 phiếu (trừ 2 lần là sai tồn)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /HAVING count\(\*\) > 1/);
    assert.match(fn[0], /mỗi mặt hàng chỉ được 1 dòng/);
  });

  it('chặn hàng dịch vụ/combo (không có tồn để điều chỉnh)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /v_type IN \('service', 'combo'\)/);
  });

  it('đếm thừa thì KHÔNG gán công trình (đích là kho)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /IF v_delta >= 0 THEN[\s\S]{0,120}v_project_id := NULL/);
  });

  it('gán bổ sung công trình KHÔNG đụng tồn kho (xóa dòng cũ theo adjust_id)', () => {
    const assign = sql.match(/CREATE OR REPLACE FUNCTION public\.assign_adjust_project\([\s\S]*?END;\n\$\$;/);
    assert.ok(assign, 'phải tìm được thân assign_adjust_project');
    assert.ok(!/UPDATE public\.products/.test(assign[0]), 'gán công trình KHÔNG được đụng products');
    assert.ok(!/INSERT INTO public\.stock_movements/.test(assign[0]), 'gán công trình KHÔNG ghi thẻ kho mới');
    // Xoá đúng 1 dòng theo khóa liên kết, không đoán theo sku.
    assert.match(assign[0], /DELETE FROM public\.project_materials WHERE adjust_id = p_adjustment_id;/);
    assert.ok(!/WHERE sku =/.test(assign[0]), 'không được đoán dòng theo sku (dễ xoá nhầm công trình khác)');
  });

  it('ghi thẻ kho với movement_type thật (adjust_loss / adjust_gain)', () => {
    assert.match(sql, /add column if not exists movement_type text/);
    assert.match(sql, /CASE WHEN v_delta < 0 THEN 'adjust_loss' ELSE 'adjust_gain' END/);
    // Backfill dòng cũ + siết NOT NULL sau khi backfill.
    assert.match(sql, /update public\.stock_movements\s*\nset movement_type = case/);
    assert.match(sql, /alter column movement_type set not null/);
    // Client đọc cột thật thay vì chỉ đoán bằng regex note.
    assert.match(shiftStock, /note, created_at, movement_type/);
    // UI hiển thị nhãn cho 2 loại mới.
    assert.match(read('components/inventory/InventoryView.tsx'), /adjust_loss: 'Hao hụt \/ Giảm tồn'/);
  });

  it('sổ điều chỉnh có đủ trường truy vết (ai, lúc nào, vì sao, tồn trước/sau)', () => {
    assert.match(sql, /adjusted_by uuid/);
    assert.match(sql, /adjusted_by_name text/);
    assert.match(sql, /previous_stock numeric\(14,3\) not null/);
    assert.match(sql, /counted_stock numeric\(14,3\)/);
    assert.match(sql, /project_assigned_at timestamptz/);
    // RLS: đọc thì ai cũng được, ghi thì chỉ is_manager.
    assert.match(sql, /stock_adjustments_read_authenticated[\s\S]{0,120}for select to authenticated using \(true\)/);
    assert.match(sql, /stock_adjustments_write_manager[\s\S]{0,160}with check \(public\.is_manager\(\)\)/);
  });

  it('UI: có cả 2 cách nhập (dán tồn thực + điều chỉnh lẻ) và cảnh báo chưa gán công trình', () => {
    const modal = read('components/inventory/StockAdjustModal.tsx');
    assert.match(modal, /id="btn-adjust-mode-count"/);
    assert.match(modal, /id="btn-adjust-mode-edit"/);
    assert.match(modal, /countedStock/);
    assert.match(modal, /delta/);
    // Công trình TÙY CHỌN: có lựa chọn "chưa gán công trình" trong danh sách.
    assert.match(modal, /Kho \(chưa gán công trình\)/);
    // Bảng sổ điều chỉnh cho phép gán bổ sung và cảnh báo số mục chưa gán.
    assert.match(adjustTable, /chưa gán công trình/);
    assert.match(adjustTable, /Gán công trình/);
    assert.match(read('components/inventory/InventoryView.tsx'), /unassignedLosses\.length > 0/);
  });

  it('client ghi server TRƯỚC rồi mới cập nhật local (không lặp lại lỗi mất dữ liệu của xuất vật tư)', () => {
    const body = projects.match(/const adjustStock = useCallback\([\s\S]*?\n  \);/);
    assert.ok(body);
    const rpcIdx = body[0].indexOf("supa.rpc('adjust_stock'");
    const localStockIdx = body[0].indexOf('setProducts((prev)');
    const localMovementsIdx = body[0].indexOf('setStockMovements((prev)');
    assert.ok(rpcIdx > 0, 'phải gọi RPC adjust_stock');
    assert.ok(rpcIdx < localStockIdx, 'RPC phải chạy TRƯỚC setProducts');
    assert.ok(rpcIdx < localMovementsIdx, 'RPC phải chạy TRƯỚC setStockMovements');
    // Không chỉ ghi local rồi mới đẩy (đó là lỗi khiến dữ liệu mất khi tải lại trang).
    assert.ok(!/enqueueOp\('adjust/.test(body[0]));
  });

  it('mapping project_materials giữ cờ is_adjust khi kéo từ server', () => {
    assert.match(projects, /is_adjust: r\.is_adjust === true/);
  });

  // ---- Chống ghi trùng (sổ điều chỉnh từng hiện 2 dòng giống nhau cho 1 lần lập phiếu) ----
  it('client gửi clientRef ổn định cho mỗi dòng để server chống ghi trùng', () => {
    const body = projects.match(/const adjustStock = useCallback\([\s\S]*?\n  \);/);
    assert.ok(body);
    assert.match(body[0], /clientRef: ref/);
    // id dòng local PHẢI là clientRef đã gửi, không phải chuỗi ngẫu nhiên khác
    assert.match(body[0], /id: clientRefs\.get\(i\.product\.id\)/);
    // Không được tự sinh id ngẫu nhiên rời rạc (đó là nguyên nhân dòng trùng)
    assert.ok(!/id: `adj-\$\{Date\.now\(\)\}-\$\{Math\.random/.test(body[0]));
  });

  it('server có client_ref UNIQUE và bỏ qua dòng đã ghi (idempotent)', () => {
    assert.match(sql, /add column if not exists client_ref text/);
    assert.match(sql, /create unique index if not exists uq_stock_adjustments_client_ref[\s\S]{0,120}where client_ref is not null/);
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.adjust_stock\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /IF v_ref IS NOT NULL AND EXISTS \(SELECT 1 FROM public\.stock_adjustments WHERE client_ref = v_ref\) THEN[\s\S]{0,200}CONTINUE;/);
    // Không skip được trước khi trừ tồn — CONTINUE phải nằm TRƯỚC UPDATE products
    const skipIdx = fn[0].indexOf('CONTINUE;');
    const updIdx = fn[0].indexOf('UPDATE public.products SET stock_quantity');
    assert.ok(skipIdx > 0 && updIdx > skipIdx, 'phải CONTINUE (bỏ qua) trước khi trừ tồn');
    // Báo số dòng bị bỏ qua để client biết mình vừa gửi trùng
    assert.match(fn[0], /'skipped', v_skipped/);
  });

  it('client gộp dòng theo id thay vì cộng thẳng (cộng thẳng là lý do dòng trùng)', () => {
    const body = projects.match(/const adjustStock = useCallback\([\s\S]*?\n  \);/);
    assert.ok(body);
    assert.match(body[0], /const byId = new Map\(prev\.map\(\(a\) => \[a\.id, a\]\)\);[\s\S]{0,120}byId\.set\(a\.id, a\);/);
    assert.ok(!/setStockAdjustments\(\(prev\) => \[\.\.\.adjustments, \.\.\.prev\]\)/.test(body[0]));
    // Dòng kéo từ server cũng dùng client_ref làm khoá để khớp dòng local
    const refresh = projects.match(/const refreshServerStockAdjustments = useCallback\([\s\S]*?\n  \);/);
    assert.ok(refresh);
    assert.match(refresh[0], /id: String\(row\.client_ref \|\| row\.id\)/);
    assert.match(refresh[0], /select\('id, client_ref, code/);
  });

  it('có nút in ấn + xuất Excel cho cả 3 tab của màn Kho', () => {
    const inv = read('components/inventory/InventoryView.tsx');
    // 3 tab đều có TableTools (export + print)
    for (const tab of ['stocks', 'movements', 'adjustments']) {
      assert.match(
        inv,
        new RegExp(`activeTab === '${tab}' && <TableTools`),
        `tab ${tab} phải có nút In/Xuất Excel`
      );
    }
    assert.match(inv, /const handleExportAdjustments = \(\) =>/);
    assert.match(inv, /const handlePrintAdjustments = \(\) =>/);
    assert.match(inv, /exportToExcel\('so-dieu-chinh-ton'/);
    assert.match(inv, /title: 'Sổ điều chỉnh tồn kho/);
  });
});
