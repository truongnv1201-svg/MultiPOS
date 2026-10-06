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
    assert.doesNotMatch(database, /generateImportCode|generateAdjustCode/);
    assert.match(store, /storedSuppliers/);
  });

  it('mã tạm NH/PQ sinh từ max local (server đánh số chính thức khi sync — 0073)', () => {
    const shiftStock = read('lib/store/tx/shift-stock.tsx');
    assert.match(shiftStock, /nextDailyCode\(localCodes, 'NH', stamp\)/);
    assert.ok(!/serverCodes/.test(shiftStock), 'producer không được quét mã server nữa');
    const projects = read('lib/store/tx/projects.tsx');
    assert.match(projects, /nextDailyCode\(\s*stockAdjustments\.map\(\(a\) => a\.code\),\s*'PQ',/);
    assert.match(projects, /p_code: null,/);
    assert.doesNotMatch(shiftStock, /const refCode = generateImportCode\(\)/);
  });

  it('replay NH gửi p_code null, vá mã server vào local (khỏi bump + gửi lại)', () => {
    const debts = read('lib/store/tx/debts.tsx');
    assert.match(debts, /p_code: null,/);
    assert.match(debts, /codeRemap/);
    assert.match(debts, /purchaseOrders\.where\('code'\)\.equals\(p\.code\)\.modify\(\{ code: finalCode \}\)/);
    assert.ok(!/Mã phiếu nhập đã tồn tại/.test(debts), 'worker không còn vòng retry trùng mã');
    assert.ok(!/nextDailyCode/.test(debts), 'worker không còn tự đánh số lại');
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

describe('0071: ghi chú phiếu nhập đồng bộ 2 máy', () => {
  const sql = read('supabase/migrations/0071_import_note.sql');

  it('tồn tại migration 0071', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0071_import_note.sql')));
  });

  it('thêm cột note cho phiếu nhập + param p_note (default null, client cũ vẫn chạy)', () => {
    assert.match(sql, /alter table public\.purchase_orders add column if not exists note text/);
    assert.match(sql, /p_note text default null/);
    assert.match(sql, /drop function if exists public\.sync_stock_import\(text, text, uuid, text, jsonb, numeric, numeric, numeric\)/);
  });

  it('lưu note vào phiếu (file 0071 lịch sử; từ 0074 thẻ kho không còn note)', () => {
    assert.match(sql, /insert into public\.purchase_orders \(code, supplier_id, subtotal, discount_amount, total_amount, paid_amount, debt_amount, status, client_ref, note\)/);
    assert.match(sql, /- Ghi chú: ' \|\| v_note/);
    assert.match(sql, /grant execute on function public\.sync_stock_import\(text, text, uuid, text, jsonb, numeric, numeric, numeric, text\) to authenticated/);
  });

  it('dòng thẻ kho do hàm này sinh gắn loại import thật (khỏi đoán bằng note)', () => {
    assert.match(sql, /insert into public\.stock_movements \(reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type\)/);
    assert.match(sql, /'import'\)/);
  });

  it('client gửi note theo hàng đợi replay + lưu local', () => {
    const debts = read('lib/store/tx/debts.tsx');
    assert.match(debts, /note\?: string;/);
    assert.match(debts, /p_note: p\.note \|\| null,/);
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /note: note\.trim\(\) \|\| undefined,/);
  });
});

describe('0072: thẻ kho tự gắn loại đúng (khỏi đoán regex)', () => {
  const sql = read('supabase/migrations/0072_movement_auto_classify.sql');

  it('tồn tại migration 0072', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0072_movement_auto_classify.sql')));
  });

  it('trigger gắn loại theo mã phiếu + dấu số lượng, tôn trọng loại đã có', () => {
    assert.match(sql, /if NEW\.movement_type is not null then/);
    assert.match(sql, /when NEW\.reference_code like 'NH-%' then 'import'/);
    assert.match(sql, /when NEW\.reference_code like 'CT-%' then 'export_project'/);
    assert.match(sql, /when NEW\.reference_code like 'HD-%'/);
    assert.match(sql, /create trigger trg_stock_movements_classify/);
    assert.match(sql, /before insert on public\.stock_movements/);
  });

  it('backfill cùng luật cho dòng cũ NULL, không đụng dòng đã có loại', () => {
    assert.match(sql, /where movement_type is null/);
  });
});

describe('0073: server đánh số phiếu NH/PQ như HD', () => {
  const sql = read('supabase/migrations/0073_server_voucher_codes.sql');

  it('tồn tại migration 0073', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0073_server_voucher_codes.sql')));
  });

  it('giữ nguyên signature 2 RPC (client cũ + PostgREST cache không gãy)', () => {
    assert.match(sql, /create or replace function public\.sync_stock_import\(\s*p_client_ref text,\s*p_code text,/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.adjust_stock\(\s*p_code TEXT,\s*p_items JSONB/);
    assert.ok(!/p_code text default null/.test(sql), 'không thêm default làm đổi arity hiển thị');
  });

  it('sync_stock_import sinh mã NH khi p_code null/rỗng, quét va chạm mã client-era', () => {
    assert.match(sql, /v_auto := \(p_code is null or btrim\(p_code\) = ''\)/);
    assert.match(sql, /v_code := public\.generate_order_code\('NH'\)/);
    assert.match(sql, /exit when not exists \(select 1 from public\.purchase_orders where code = v_code\)/);
  });

  it('mã auto đua nhau thì thử số mới, mã explicit trùng vẫn báo như cũ', () => {
    assert.match(sql, /for attempt in 1\.\.3 loop/);
    assert.match(sql, /if not v_auto or attempt = 3 then/);
    assert.match(sql, /raise exception 'Mã phiếu nhập đã tồn tại: %', v_code/);
  });

  it('adjust_stock sinh mã PQ khi p_code null/rỗng, không cần vòng chống trùng (code không unique)', () => {
    assert.match(sql, /v_code := public\.generate_order_code\('PQ'\)/);
    assert.match(sql, /VALUES \(\s*v_code, v_pid, v_delta, v_stock, v_new,/);
  });

  it('cả 2 RPC trả mã chốt trong jsonb để client vá local', () => {
    assert.match(sql, /'code', v_code,/);
  });

  it('client adjustStock dùng mã server, fallback mã tạm khi server cũ', () => {
    const projects = read('lib/store/tx/projects.tsx');
    assert.match(projects, /const fallbackCode = nextDailyCode\(/);
    assert.match(projects, /const code = typeof serverCode === 'string' && serverCode \? serverCode : fallbackCode;/);
  });
});

describe('0074: ghi chú phiếu nhập khỏi dòng thẻ kho', () => {
  const sql = read('supabase/migrations/0074_import_note_off_movements.sql');

  it('tồn tại migration 0074', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0074_import_note_off_movements.sql')));
  });

  it('giữ nguyên signature RPC (client cũ không gãy), note vẫn lưu ở phiếu', () => {
    assert.match(sql, /create or replace function public\.sync_stock_import\(\s*p_client_ref text,\s*p_code text,/);
    assert.match(sql, /p_note text default null/);
    assert.match(sql, /insert into public\.purchase_orders \(code, supplier_id, subtotal, discount_amount, total_amount, paid_amount, debt_amount, status, client_ref, note\)/);
    assert.match(sql, /grant execute on function public\.sync_stock_import\(text, text, uuid, text, jsonb, numeric, numeric, numeric, text\) to authenticated/);
  });

  it('dòng thẻ kho không còn ghi chú phiếu, vẫn giữ NCC + MAC + loại import', () => {
    assert.ok(!/- Ghi chú: ' \|\| v_note/.test(sql), 'còn chép ghi chú vào thẻ kho');
    assert.match(sql, /'Nhập kho \(' \|\| v_sup_name \|\| '\)' \|\|/);
    assert.match(sql, /' - MAC: ' \|\| v_avg::text \|\| ' -> ' \|\| v_new_avg::text/);
    assert.match(sql, /'import'\)/);
  });

  it('client + trang đơn nhập: note ở phiếu, khỏi thẻ kho', () => {
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /note: `Nhập kho \(\$\{resolvedSupplierName\}\) - MAC:/);
    assert.match(shift, /note: note\.trim\(\) \|\| undefined,/);
    const view = read('components/imports/ImportsView.tsx');
    assert.match(view, /selectedPo\.note &&/);
  });
});
