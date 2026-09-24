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
      if (p.includes('components\\common\\Toast.tsx')) continue; // fallback có chủ đích
      if (p.includes('scripts\\sql-guard.test.mjs')) continue; // test file
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
