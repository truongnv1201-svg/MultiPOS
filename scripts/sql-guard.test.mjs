// Test tĩnh khóa các bản vá thương mại P0 (0050/0051 + error boundary + Toast).
// Chạy: npm test (node --test ...). Không cần mạng/DB — đọc file và assert chuỗi guard,
// để regression (ai đó mở lại anon SELECT *, tin giá client, xóa boundary) rớt CI ngay.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

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
    assert.match(read('components/products/AddProductFormModal.tsx'), /Cho phép bán số lượng thập phân/);
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
