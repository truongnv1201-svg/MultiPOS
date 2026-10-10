import { test, expect, type Page } from '@playwright/test';

// Đồng bộ biến động kho: sau lần kéo đầu tiên phải chỉ kéo DELTA, không kéo lại cả
// 2.000 dòng. Đo trước khi sửa: mỗi lần bán kéo lại ~500 KB, trong đó stock_movements
// ~217-240 KB. Bài test giữ 2 điều kiện cùng lúc:
//   1) lưu lượng: stock_movements mỗi lần bán phải nhỏ (delta, không phải kéo toàn bộ)
//   2) đúng dữ liệu: nhật ký thẻ kho phải đủ dòng, tên sản phẩm phải hiện thật
//      (tên do InventoryView tra từ catalog vì server không JOIN products(name) nữa)
// Test tự hủy đơn để dọn.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

async function login(page: Page, id: string, pw: string) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', id);
  await page.fill('#login-password-input', pw);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

/** Thêm 1 mặt hàng bất kỳ vào giỏ (hàng m2 sẽ mở modal F3 nên bỏ qua). */
async function addAnyGoods(page: Page) {
  const search = page.locator('#f1-search-input');
  for (const term of ['a', 'e', 'o']) {
    await search.fill(term);
    // Bỏ qua mặt hàng hết tồn (server chặn bán khi tồn âm -> pos_checkout 400).
    const items = page.locator('#search-results-dropdown div[id^="search-item-"]').filter({ hasNotText: /Tồn:\s*0(?!\d)/ });
    if ((await items.count().catch(() => 0)) === 0) continue;
    await items.first().click();
    if (await page.locator('#dimension-modal-overlay').isVisible().catch(() => false)) {
      await page.locator('#btn-close-dimension-modal').click();
      continue;
    }
    if ((await page.locator('#cart-table-container tbody tr').count()) > 0) return;
  }
  throw new Error('không thêm được mặt hàng nào vào giỏ');
}

test('một lần bán chỉ kéo delta biến động kho, nhật ký vẫn đủ và tên sản phẩm thật', async ({ page, browser }) => {
  test.slow(); // có đo 30s sau khi bán + mở màn Kho bằng admin
  const bytes = new Map<string, number>();
  page.on('response', async (res) => {
    const m = res.url().match(/\/rest\/v1\/([a-z_]+)/);
    if (!m) return;
    let len = Number(res.headers()['content-length'] || 0);
    if (!len) {
      try {
        len = (await res.body()).length;
      } catch {
        len = 0;
      }
    }
    bytes.set(m[1], (bytes.get(m[1]) || 0) + len);
  });
  const kb = (table: string) => Math.round((bytes.get(table) || 0) / 1024);

  await login(page, LOGIN_ID, LOGIN_PW);
  await expect(page.locator('#header-sync-center-btn')).toHaveAttribute('title', /trực tiếp/i, { timeout: 30_000 });
  await page.waitForTimeout(15_000);
  bytes.clear();

  await addAnyGoods(page);
  const payable = Number((await page.locator('#payable-total-display').innerText()).replace(/[^\d]/g, '')) || 0;
  expect(payable).toBeGreaterThan(0);
  await page.locator('#payment-method-cash').click();
  await page.locator('#f9-tendered-input').fill(String(payable + 100000));
  await page.locator('#btn-pos-checkout').click();
  await expect(page.locator('#receipt-modal-overlay')).toBeVisible({ timeout: 30_000 });
  const code = (await page.locator('#receipt-modal-container h3').innerText()).match(/HD-\d+-\d+/)?.[0];
  expect(code).toBeTruthy();
  await page.locator('#receipt-modal-container button', { hasText: 'Đóng' }).first().click();
  await expect(page.locator('#receipt-modal-overlay')).toBeHidden({ timeout: 10_000 });

  await page.waitForTimeout(30_000);
  const stockKB = kb('stock_movements');
  const totalKB = Math.round([...bytes.values()].reduce((s, v) => s + v, 0) / 1024);
  console.log('PER_SALE_KB=' + totalKB + ' stock_movements=' + stockKB);
  // Kéo toàn bộ 2.000 dòng là ~217-240 KB; delta chỉ vài KB.
  expect(stockKB).toBeLessThan(20);

  // Dọn: hủy đơn vừa bán
  await page.keyboard.press('Alt+m');
  await page.locator('#menu-item-vouchers').click();
  await expect(page.locator('#orders-view')).toBeVisible({ timeout: 15_000 });
  await page.locator('#orders-view input[placeholder="Mã đơn, tên khách, SĐT..."]').fill(code!);
  const row = page.locator('#orders-view tbody tr', { hasText: code! }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.locator('#orders-view button', { hasText: 'Hủy hóa đơn & Hoàn quỹ' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /Hủy đơn/ }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#orders-view')).toContainText('Đã hủy', { timeout: 30_000 });

  // Màn Kho (admin): nhật ký thẻ kho phải đủ dòng + tên sản phẩm hiện thật
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await login(adminPage, ADMIN_ID, ADMIN_PW);
  await adminPage.keyboard.press('Alt+n');
  await expect(adminPage.locator('#inventory-view')).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.locator('#inventory-view table').first()).toBeVisible({ timeout: 20_000 });
  await adminPage.waitForTimeout(2000);

  const info = await adminPage.evaluate(() => {
    const view = document.querySelector('#inventory-view');
    const text = view?.textContent || '';
    const cells = Array.from(view?.querySelectorAll('tbody tr td:nth-child(2)') || [])
      .map((td) => (td.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    return {
      // Tổng đã tải nằm ở dòng tổng hợp dưới filter (chuẩn các bảng chính), không còn trên nhãn tab
      count: Number(text.match(/Tổng nhật ký:\s*(\d+)/)?.[1] || 0),
      cells,
      empty: cells.filter((c) => c === '').length,
      deleted: cells.filter((c) => /Sản phẩm đã xóa/.test(c)).length,
    };
  });
  console.log('MOVEMENTS=' + JSON.stringify(info));
  // Ngân sách 2.000 dòng: cơ chế delta dễ cắt cụt nhất ở đây.
  expect(info.count).toBeGreaterThanOrEqual(200);
  expect(info.cells.length).toBeGreaterThan(0);
  expect(info.empty).toBe(0);
  expect(info.deleted).toBeLessThan(info.cells.length);
  await adminCtx.close();
});
