// Test tĩnh khóa các bản vá thương mại P0 (0050/0051 + error boundary + Toast).
// Chạy: npm test (node --test ...). Không cần mạng/DB — đọc file và assert chuỗi guard,
// để regression (ai đó mở lại anon SELECT *, tin giá client, xóa boundary) rớt CI ngay.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('0050: server price authority (pos_checkout)', () => {
  const sql = read('supabase/migrations/0050_checkout_price_guard.sql');

  it('tồn tại migration 0050', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0050_checkout_price_guard.sql')));
  });

  it('lookup giá/tên/đvt/loại/waste server theo SKU, từ chối SKU lạ', () => {
    assert.match(sql, /FROM public\.products p WHERE p\.sku/);
    assert.match(sql, /SKU không tồn tại trong catalog/);
  });

  it('kẹp CK dòng theo tiền dòng, CK bill/ship >= 0, VAT allowlist', () => {
    assert.match(sql, /LEAST\(v_disc, GREATEST\(v_line_cap, 0\)\)/);
    assert.match(sql, /GREATEST\(COALESCE\(p_discount, 0\), 0\)/);
    assert.match(sql, /NOT IN \(0, 5, 8, 10\)/);
  });

  it('rebuild fee tấm area từ grinding_services server + lỗ/góc kẹp', () => {
    assert.match(sql, /FROM public\.grinding_services WHERE id/);
    assert.match(sql, /v_holes \* 25000 \+ v_corners \* 15000/);
  });

  it('idempotency chống TOCTOU qua unique_violation -> duplicate', () => {
    assert.match(sql, /EXCEPTION WHEN unique_violation THEN/);
    assert.match(sql, /'duplicate', true/);
  });

  it('khóa FOR UPDATE dòng kho trước khi trừ', () => {
    assert.match(sql, /FOR UPDATE/);
  });

  it('giữ phân quyền: revoke anon, grant authenticated', () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.pos_checkout\(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT\) FROM anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.pos_checkout\(TEXT, JSONB, NUMERIC, JSONB, TEXT, NUMERIC, BOOLEAN, UUID, NUMERIC, TEXT\) TO authenticated/);
  });
});

describe('0051: catalog public ẩn giá vốn', () => {
  const sql = read('supabase/migrations/0051_catalog_public_view.sql');

  it('view catalog_public không chứa cột giá vốn', () => {
    assert.match(sql, /CREATE OR REPLACE VIEW public\.catalog_public AS/);
    assert.ok(!/import_price|avg_cost|trade_price/.test(
      sql.slice(sql.indexOf('CREATE OR REPLACE VIEW'), sql.indexOf('FROM public.products'))
    ), 'view không được select cột giá vốn');
  });

  it('thu hồi anon khỏi bảng gốc, chỉ authenticated được đọc products', () => {
    assert.match(sql, /DROP POLICY IF EXISTS "catalog_read_anon" ON public\.products/);
    assert.match(sql, /products_read_authenticated/);
    assert.match(sql, /FOR SELECT TO authenticated USING \(true\)/);
  });

  it('client fallback sang view khi anon', () => {
    const catalog = read('lib/store/catalog.tsx');
    assert.match(catalog, /from\('catalog_public'\)/);
  });
});

describe('0053: supplier debt guard', () => {
  const sql = read('supabase/migrations/0053_supplier_debt_owner_guard.sql');

  it('tồn tại migration 0053', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0053_supplier_debt_owner_guard.sql')));
  });

  it('tính và kiểm tra tổng, tiền trả, tiền nợ từ dữ liệu phiếu', () => {
    assert.match(sql, /v_actual_total := v_actual_total \+ v_qty \* v_price/);
    assert.match(sql, /Tổng tiền phiếu không khớp dòng hàng/);
    assert.match(sql, /Số tiền còn nợ không khớp tổng phiếu/);
  });

  it('rollback toàn bộ khi một dòng hàng không resolve được', () => {
    assert.match(sql, /Không tìm thấy hàng hóa trong danh mục server/);
    assert.ok(!/if v_qty <= 0 or v_price <= 0 then continue/.test(sql));
    assert.ok(sql.indexOf('v_actual_total') < sql.indexOf('insert into public.purchase_orders'));
  });

  it('chặn nợ vô chủ, xử lý trùng client_ref và giới hạn quyền nhập kho', () => {
    assert.match(sql, /if not public\.is_manager\(\)/);
    assert.match(sql, /Nợ vô chủ/);
    assert.match(sql, /exception when unique_violation then/);
    assert.match(sql, /duplicate', true/);
    assert.match(sql, /create or replace function public\.pay_supplier_debt/);
    assert.match(sql, /p_amount::text in \('NaN', 'Infinity', '-Infinity'\)/);
    assert.match(sql, /purchase_orders_write[\s\S]*public\.is_manager\(\)/);
    assert.match(sql, /drop function if exists public\.sync_stock_import\(text, text, uuid, text, jsonb, numeric\)/);
  });

  it('client giữ op chưa đủ điều kiện và tuần tự hóa sync', () => {
    const debts = read('lib/store/tx/debts.tsx');
    const shiftStock = read('lib/store/tx/shift-stock.tsx');
    const store = read('lib/store.tsx');
    const database = read('lib/db.ts');
    assert.match(debts, /syncLockRef/);
    assert.match(debts, /if \(debt > 0 && !serverSupplierId\) \{/);
    assert.match(shiftStock, /const importQueued = await enqueueOp\('import'/);
    assert.match(shiftStock, /roundMoney/);
    assert.match(database, /generateImportCode/);
    assert.match(store, /storedSuppliers/);
  });
});

describe('0054: số lượng thập phân theo mặt hàng', () => {
  const sql = read('supabase/migrations/0054_decimal_quantity.sql');

  it('tồn tại migration 0054', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0054_decimal_quantity.sql')));
  });

  it('thêm cột allow_decimal mặc định false (hàng đếm theo cái giữ số nguyên)', () => {
    assert.match(sql, /add column if not exists allow_decimal boolean not null default false/);
  });

  it('0055 đổi mặc định sang true và backfill mặt hàng hiện có', () => {
    const sql55 = read('supabase/migrations/0055_decimal_default_true.sql');
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0055_decimal_default_true.sql')));
    assert.match(sql55, /alter column allow_decimal set default true/);
    assert.match(sql55, /update public\.products set allow_decimal = true where allow_decimal = false/);
    // Client cũng phải coi "chưa có cờ" là được phép thập phân
    assert.match(read('lib/quantity.ts'), /return input\.allow_decimal !== false;/);
  });

  it('catalog_public dựng lại kèm cột mới và KHÔNG lộ giá vốn', () => {
    assert.match(sql, /CREATE OR REPLACE VIEW public\.catalog_public as/i);
    const view = sql.slice(sql.toLowerCase().indexOf('create or replace view'), sql.indexOf('grant select'));
    assert.ok(!/import_price|avg_cost|trade_price/.test(view), 'view không được chọn cột giá vốn');
    assert.match(view, /allow_decimal/);
  });

  it('client đọc cờ allow_decimal (catalog, master data, form hàng hóa)', () => {
    const catalog = read('lib/store/catalog.tsx');
    assert.match(catalog, /allow_decimal: row\.allow_decimal === true/);
    assert.match(catalog, /allow_decimal: data\.allow_decimal === true/);
    assert.match(read('components/products/AddProductFormModal.tsx'), /Chỉ bán số lượng nguyên/);
    assert.match(read('lib/types.ts'), /allow_decimal\?: boolean/);
  });

  it('số lượng thập phân chỉ chuẩn hoá ở client, RPC không ép số nguyên', () => {
    assert.match(read('lib/quantity.ts'), /export function snapQty/);
    assert.match(read('lib/quantity.ts'), /QTY_MAX_DECIMALS = 3/);
    const checkout = read('supabase/migrations/0050_checkout_price_guard.sql');
    assert.match(checkout, /it->>'quantity'\)::NUMERIC/);
    assert.ok(
      !/quantity::int|trunc\(\s*[^)]*quantity|floor\(\s*[^)]*quantity/.test(checkout),
      'pos_checkout không được ép quantity về số nguyên'
    );
  });
});

describe('error boundary chống trắng trang', () => {
  it('có app/error.tsx và app/global-error.tsx', () => {
    assert.ok(existsSync(join(ROOT, 'app/error.tsx')), 'thiếu app/error.tsx');
    assert.ok(existsSync(join(ROOT, 'app/global-error.tsx')), 'thiếu app/global-error.tsx');
  });
});

describe('alert() blocking đã thay bằng Toast', () => {
  const skipDirs = new Set(['.git', '.next', 'node_modules', 'test-results', 'playwright-report']);
  const hits = [];
  const walk = (dir) => {
    // Thư mục có thể vắng mặt trên checkout mới (git không lưu thư mục rỗng,
    // VD xóa file ma cuối cùng trong hooks/) — bỏ qua thay vì nổ scandir.
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(tsx?|ts)$/.test(e.name)) continue;
      const normalizedPath = p.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/components/common/Toast.tsx')) continue;
      if (normalizedPath.endsWith('/scripts/sql-guard.test.mjs')) continue;
      const src = readFileSync(p, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        if (/\balert\(/.test(line)) hits.push(`${p}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
  };
  walk(join(ROOT, 'app'));
  walk(join(ROOT, 'components'));
  walk(join(ROOT, 'lib'));
  walk(join(ROOT, 'hooks'));

  it('không còn alert() chặn luồng ngoài Toast fallback', () => {
    assert.deepEqual(hits, [], `còn alert():\n${hits.join('\n')}`);
  });
});

describe('0061: đã gỡ làm tròn tiền mặt (kế toán 2026-09)', () => {
  it('migration 0061 ép checkout_order về cash_rounding = 0', () => {
    const sql = read('supabase/migrations/0061_remove_cash_rounding.sql');
    assert.match(sql, /v_cash_rounding := 0;/);
    // không còn đọc mệnh giá làm tròn ở server
    assert.ok(!/key = 'cash_rounding';\s*\n\s*INTO v_rounding_denom/.test(sql));
    assert.ok(!/v_rounding_denom/.test(sql), 'đã gỡ biến mệnh giá');
    // xoá hàng cấu hình để không bật lại được
    assert.match(sql, /delete from public\.settings where key = 'cash_rounding'/i);
    assert.ok(!/drop column[^;]*cash_rounding/i.test(sql), '0061 chưa drop cột');
  });

  it('client không còn tính làm tròn tiền mặt', () => {
    const pricing = read('lib/pricing.ts');
    // payable không được trừ phần làm tròn
    assert.ok(!/cashRounding: number\) : CartTotals/.test(pricing), 'đã bỏ tham số mệnh giá');
    assert.ok(!/rawPayable % roundingDenom/.test(pricing), 'đã bỏ phép % mệnh giá');
    assert.ok(!/cash_rounding/.test(pricing), 'đã bỏ hẳn trường cash_rounding');
    assert.match(pricing, /const payable = Math\.max\(0, subtotal \+ shipping \+ vat_amount - discount\);/);
  });

  it('UI không còn ô cấu hình / hiển thị làm tròn', () => {
    assert.ok(!/cashRounding/.test(read('components/settings/SettingsView.tsx')));
    assert.ok(!/cashRounding/.test(read('components/pos/MobilePaymentSheet.tsx')));
    assert.ok(!/cash-rounding-display/.test(read('components/pos/POSScreen.tsx')));
  });
});

describe('0063: RPC xuất vật tư công trình (tab POS "Xuất CT")', () => {
  const sql = read('supabase/migrations/0063_issue_project_materials_rpc.sql');

  it('tự trừ kho + ghi thẻ kho (0040 đã bỏ trigger nên hàm phải tự làm)', () => {
    assert.match(sql, /UPDATE public\.products\s+SET stock_quantity = stock_quantity - v_qty/);
    assert.match(sql, /INSERT INTO public\.stock_movements/);
    assert.match(sql, /FOR UPDATE/);
  });

  it('chỉ authenticated — phải revoke PUBLIC (PostgreSQL mặc định cấp EXECUTE cho PUBLIC)', () => {
    // Regression thật: chỉ revoke anon là KHÔNG đủ, anon vẫn gọi được và xuất kho.
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.issue_project_materials\(UUID, JSONB\) FROM PUBLIC;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.issue_project_materials\(UUID, JSONB\) TO authenticated;/);
  });

  it('server là chân lý: tồn đủ, SKU có thật, giá vốn lấy từ avg_cost', () => {
    assert.match(sql, /v_stock < v_qty/);
    assert.match(sql, /IF v_pid IS NULL THEN/);
    assert.match(sql, /unit_cost\)\s*VALUES[^;]*round\(v_avg, 2\)/);
  });

  it('tránh lỗi "column reference ambiguous" (biến plpgsql trùng alias bảng)', () => {
    assert.ok(!/it JSONB/.test(sql), 'không khai báo biến `it` trùng alias jsonb_array_elements');
  });

  it('client gọi RPC trước khi cập nhật local (nếu không, dữ liệu mất khi sync kéo về)', () => {
    const src = read('lib/store/tx/projects.tsx');
    // So sánh TRONG hàm batch (hàm đầu tiên cũng có recalcProjectTotals -> dễ so nhầm chỗ)
    const fnAt = src.indexOf('const exportProjectMaterialBatch');
    assert.ok(fnAt > 0, 'phải còn hàm exportProjectMaterialBatch');
    const body = src.slice(fnAt, src.indexOf('const addProjectWorker', fnAt));
    const rpcAt = body.indexOf("supa.rpc('issue_project_materials'");
    const localAt = body.indexOf('recalcProjectTotals');
    assert.ok(rpcAt > 0, 'phải có lời gọi RPC');
    assert.ok(localAt > 0, 'phải còn cập nhật local');
    assert.ok(rpcAt < localAt, 'phải ghi server TRƯỚC khi cập nhật local');
  });
});

describe('0062: xoá cột orders.cash_rounding (dữ liệu thử nghiệm)', () => {
  const sql = read('supabase/migrations/0062_drop_cash_rounding_column.sql');
  // Bỏ dòng comment để assert chỉ soi phần code thực thi
  const code = sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');

  it('thay checkout_order: bỏ biến và cột, giữ nguyên công thức', () => {
    assert.ok(!/v_cash_rounding/.test(code), 'đã bỏ biến v_cash_rounding');
    assert.ok(!/cash_rounding = v_cash_rounding/.test(code), 'đã bỏ cột trong UPDATE orders');
    assert.match(code, /total_amount = v_payable \+ v_vat - p_discount,/);
  });

  it('pos_checkout không còn trả khoá cash_rounding', () => {
    assert.ok(!/'cash_rounding', o\.cash_rounding/.test(code));
    // giữ nguyên tín hiệu 0060 (đừng làm mất)
    assert.match(code, /'price_adjusted', v_price_adjusted\)/);
  });

  it('drop cột sau khi đã thay cả hai hàm', () => {
    assert.match(code, /ALTER TABLE public\.orders DROP COLUMN IF EXISTS cash_rounding;/i);
    const idxFn = code.indexOf('CREATE OR REPLACE FUNCTION public.checkout_order(');
    const idxDrop = code.indexOf('DROP COLUMN');
    assert.ok(idxFn > 0 && idxDrop > idxFn, 'phải thay hàm trước rồi mới drop cột');
  });

  it('client không còn đọc/ghi cash_rounding ở bất kỳ đâu', () => {
    for (const f of [
      'lib/types.ts',
      'lib/pricing.ts',
      'lib/store.tsx',
      'lib/store/tx/orders-types.ts',
      'lib/store/tx/orders-sync.ts',
      'lib/store/tx/checkout.tsx',
      'components/pos/ReceiptModal.tsx',
      'components/orders/OrdersView.tsx',
    ]) {
      assert.ok(!/cash_rounding/.test(read(f)), `${f} còn nhắc cash_rounding`);
    }
  });
});

describe('0067: nhánh duplicate trả đúng order_code (retry an toàn)', () => {
  it('tồn tại file migration', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0067_fix_duplicate_order_code.sql')), 'thiếu 0067');
  });

  it('0067 sửa đúng chỗ (bảng orders chỉ có order_code, không có code)', () => {
    const sql = read('supabase/migrations/0067_fix_duplicate_order_code.sql');
    assert.equal((sql.match(/o\.order_code,/g) || []).length, 2);
    const code = sql
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n');
    assert.ok(!/o\.code\b/.test(code), 'không còn o.code trong code thực thi');
  });

  it('mọi bản redefine pos_checkout đều hết o.code (project mới chạy từ đầu cũng đúng)', () => {
    for (const f of [
      'supabase/migrations/0043_checkout_idempotency.sql',
      'supabase/migrations/0050_checkout_price_guard.sql',
      'supabase/migrations/0059_pos_price_override.sql',
      'supabase/migrations/0060_checkout_price_adjusted_signal.sql',
      'supabase/migrations/0062_drop_cash_rounding_column.sql',
    ]) {
      assert.ok(!/o\.code\b/.test(read(f)), `${f} còn o.code`);
    }
  });
});

describe('0068: siết quyền RPC tiền/nợ + bỏ policy thừa', () => {
  it('tồn tại file migration', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0068_money_rpc_hardening.sql')), 'thiếu 0068');
  });

  it('revoke PUBLIC + anon, chỉ authenticated được gọi RPC tiền', () => {
    const sql = read('supabase/migrations/0068_money_rpc_hardening.sql');
    for (const sig of [
      'cancel_order\\(UUID\\)',
      'return_order_items\\(UUID, NUMERIC, JSONB\\)',
      'collect_debt\\(UUID, NUMERIC, TEXT, TEXT\\)',
    ]) {
      assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${sig} FROM PUBLIC;`));
      assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${sig} FROM anon;`));
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`));
    }
  });

  it('bỏ policy insert_pending_order (không luồng nào dùng, vượt price-guard)', () => {
    const sql = read('supabase/migrations/0068_money_rpc_hardening.sql');
    assert.match(sql, /DROP POLICY IF EXISTS "insert_pending_order" ON public\.orders;/);
  });
});

describe('0069: trả từng phần đúng trạng thái + chống hoàn kho lặp', () => {
  const sql = read('supabase/migrations/0069_partial_return_status.sql');

  it('có sổ order_return_lines + index', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.order_return_lines/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_return_lines_order/);
  });

  it('cap hoàn kho trừ phần đã trả các lần trước', () => {
    assert.match(sql, /FROM public\.order_return_lines/);
    assert.match(sql, /GREATEST\(v_sold - v_returned, 0\)/);
  });

  it('trả hết mới returned, còn lại partial_returned (trả tiếp được)', () => {
    assert.match(sql, /v_new_status := CASE WHEN v_total_returned >= v_total_sold THEN 'returned' ELSE 'partial_returned' END;/);
    assert.match(sql, /'status', v_new_status\)/);
  });

  it('cancel_order từ chối đơn partial (khỏi hoàn tiền 2 lần)', () => {
    assert.match(sql, /IF r\.status = 'partial_returned' THEN/);
  });
});

describe('0070: ghi dấu vết thu ngân lên đơn (ai bán)', () => {
  const sql = read('supabase/migrations/0070_order_cashier_trace.sql');

  it('có cột cashier_name + INSERT ghi cashier_id/name lúc tạo đơn', () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS cashier_name TEXT;/);
    assert.match(sql, /cashier_id, cashier_name\)/);
    assert.match(sql, /auth\.uid\(\)/);
    assert.match(sql, /FROM public\.profiles WHERE id = auth\.uid\(\)/);
  });

  it('client hiển thị tên thật từ server, đơn cũ giữ cách cũ', () => {
    const sync = read('lib/store/tx/orders-sync.ts');
    assert.match(sync, /typeof row\.cashier_name === 'string' && row\.cashier_name/);
  });
});

describe('0066: xoá dự án tạo nhầm (delete_project)', () => {
  const sql = read('supabase/migrations/0066_delete_project_rpc.sql');
  const projects = read('lib/store/tx/projects.tsx');

  it('tồn tại file migration', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0066_delete_project_rpc.sql')));
  });

  it('chỉ Admin/Quản lý được xoá (server chặn lần 2 bằng is_manager)', () => {
    assert.match(sql, /IF NOT public\.is_manager\(\) THEN/);
    assert.match(sql, /Chỉ Admin\/Quản lý được xoá dự án/);
  });

  it('chặn anon/PUBLIC (bài học 0063: chỉ revoke anon là KHÔNG đủ)', () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.delete_project\(UUID\) FROM PUBLIC;/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.delete_project\(UUID\) FROM anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.delete_project\(UUID\) TO authenticated;/);
  });

  it('hoàn kho CHỈ cho dòng xuất thật, bỏ qua dòng hao hụt is_adjust', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.delete_project\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn, 'phải tìm được thân hàm delete_project');
    assert.match(fn[0], /WHERE project_id = p_project_id AND NOT COALESCE\(is_adjust, false\)/);
  });

  it('ghi thẻ kho đảo movement_type=return cho mỗi dòng hoàn (giống removeProjectLine)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.delete_project\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /'return'/);
    assert.match(fn[0], /Trả kho khi xoá dự án/);
  });

  it('giữ audit hao hụt: chỉ gỡ project_id về NULL, KHÔNG xoá stock_adjustments', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.delete_project\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.match(fn[0], /UPDATE public\.stock_adjustments SET project_id = NULL WHERE project_id = p_project_id;/);
    assert.ok(!/DELETE FROM public\.stock_adjustments/.test(fn[0]), 'không được xoá sổ audit hao hụt');
  });

  it('không đụng sổ quỹ (tiền đã thu là lịch sử, UI phải báo rõ)', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.delete_project\([\s\S]*?END;\n\$\$;/);
    assert.ok(fn);
    assert.ok(!/cashbook/i.test(fn[0]), 'RPC xoá dự án không được chạm sổ quỹ');
    const view = read('components/projects/ProjectsView.tsx');
    assert.match(view, /GIỮ NGUYÊN trong sổ quỹ/);
  });

  it('client ghi server TRƯỚC rồi mới gỡ local (không lặp lỗi mất dữ liệu)', () => {
    const body = projects.match(/const deleteProject = useCallback\([\s\S]*?\n  \);/);
    assert.ok(body, 'phải tìm được thân deleteProject');
    const rpcIdx = body[0].indexOf("supa.rpc('delete_project'");
    const localIdx = body[0].indexOf('setProjects((prev) => prev.filter');
    assert.ok(rpcIdx > 0, 'phải gọi RPC delete_project');
    assert.ok(localIdx > rpcIdx, 'RPC phải chạy TRƯỚC khi gỡ local');
  });

  it('UI có đủ nút Sửa thông tin + Xoá dự án (chỉ hiện nút Xoá cho quản lý)', () => {
    const view = read('components/projects/ProjectsView.tsx');
    assert.match(view, /id="btn-edit-project-info"/);
    assert.match(view, /id="btn-delete-project"/);
    assert.match(view, /id="btn-save-project-info"/);
    assert.match(view, /\{canDeleteProject && \(/);
  });
});
