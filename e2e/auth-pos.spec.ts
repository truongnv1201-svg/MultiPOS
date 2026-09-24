import { test, expect, type Page } from '@playwright/test';

// Smoke POS trên backend live. Tài khoản seed từ scripts/seed-users.mjs
// (cashier@multipos.local / Cashier@123); override qua env khi cần.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function loginAsCashier(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

test.describe('POS smoke (live backend)', () => {
  test('cổng login → vào màn Bán hàng sau đăng nhập', async ({ page }) => {
    await loginAsCashier(page);
    await expect(page.locator('#f1-search-input')).toBeVisible();
    await expect(page.locator('#cart-table-container')).toBeVisible();
    await expect(page.locator('#payable-total-display')).toBeVisible();
  });

  test('tìm kiếm → chọn hàng → vào giỏ (logic client, không tạo đơn)', async ({ page }) => {
    await loginAsCashier(page);
    const search = page.locator('#f1-search-input');
    // Thử nhiều term vì catalog live thay đổi; term nào ra dropdown thì dùng.
    let found = false;
    for (const term of ['a', 'e', 'o', '0', '1', 'k']) {
      await search.fill(term);
      try {
        await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
        found = true;
        break;
      } catch {
        continue;
      }
    }
    expect(found).toBe(true);
    await page.locator('#search-results-dropdown div[id^="search-item-"]').first().click();
    // resetSearch chạy sau khi chọn → ô tìm kiếm trống (áp dụng cả hàng goods lẫn area).
    await expect(search).toHaveValue('', { timeout: 10_000 });
    // Hàng goods → 1 dòng trong giỏ; hàng m² → mở modal F3.
    const cartRows = page.locator('#cart-table-container tbody tr');
    const f3 = page.locator('#dimension-modal-overlay');
    const rowCount = await cartRows.count().catch(() => 0);
    const modalCount = await f3.count();
    expect(rowCount + modalCount).toBeGreaterThan(0);
    if (modalCount > 0) await page.locator('#btn-close-dimension-modal').click();
  });
});
