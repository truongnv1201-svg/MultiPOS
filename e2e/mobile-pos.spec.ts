import { test, expect, type Page } from '@playwright/test';

// Smoke Giai đoạn 2 trên viewport điện thoại: bảng ngang phải được thay bằng
// record list / bottom sheet (cart sheet, kho, NCC) và Sync Center mở được.
// Tài khoản seed từ scripts/seed-users.mjs; override qua env khi cần.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

const PHONE_VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
];

async function loginAsCashier(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

async function loginAsAdmin(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', ADMIN_ID);
  await page.fill('#login-password-input', ADMIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

test.describe('POS mobile (live backend)', () => {
  for (const vp of PHONE_VIEWPORTS) {
    test(`dock + cart sheet + sync center @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAsCashier(page);

      // Bảng giỏ ngang phải ẩn trên mobile (record list thay thế)
      await expect(page.locator('#cart-table-container table')).toBeHidden();

      // Thêm 1 hàng vào giỏ rồi mở sheet từ dock (hàng m² đi qua modal F3 → xác nhận luôn)
      const search = page.locator('#f1-search-input');
      let added = false;
      for (const term of ['a', 'e', 'o', '0', '1', 'k']) {
        await search.fill(term);
        try {
          await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
          await page.locator('#search-results-dropdown div[id^="search-item-"]').first().click();
          const f3 = page.locator('#dimension-modal-overlay');
          if ((await f3.count()) > 0) {
            await page.locator('#btn-confirm-dimension-modal').click();
            await expect(page.locator('#dimension-modal-overlay')).toHaveCount(0);
          }
          await expect(page.locator('#btn-pos-mobile-cart-summary')).toBeVisible({ timeout: 10_000 });
          added = true;
          break;
        } catch {
          if ((await page.locator('#dimension-modal-overlay').count()) > 0) {
            await page.locator('#btn-cancel-dimension-modal').click();
          }
          continue;
        }
      }
      expect(added).toBe(true);

      await page.locator('#btn-pos-mobile-cart').click();
      await expect(page.locator('#cart-record-list')).toBeVisible();
      await page.locator('#cart-record-list button[aria-label="Đóng giỏ hàng"]').click();
      await expect(page.locator('#cart-record-list')).toHaveCount(0);

      // Sync Center mở được từ header và đóng lại được
      await page.locator('#header-sync-center-btn').click();
      await expect(page.getByRole('dialog', { name: 'Trung tâm đồng bộ' })).toBeVisible();
      await page.locator('button[aria-label="Đóng trung tâm đồng bộ"]').first().click();
      await expect(page.getByRole('dialog', { name: 'Trung tâm đồng bộ' })).toHaveCount(0);
    });
  }

  test('kho + NCC dùng record list, mở sheet chi tiết NCC @ 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);

    // Kho: Alt+N là phân hệ bị chặn với cashier, admin đi qua menu phân hệ
    await page.keyboard.press('Alt+n');
    await expect(page.locator('#inventory-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#stock-record-list')).toBeVisible();
    await expect(page.locator('#stock-record-list table')).toHaveCount(0);

    // NCC: Alt+K
    await page.keyboard.press('Alt+k');
    await expect(page.locator('#suppliers-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#supplier-record-list')).toBeVisible();
    await expect(page.locator('#supplier-record-list table')).toHaveCount(0);

    const firstRow = page.locator('#supplier-record-list > button').first();
    if ((await page.locator('#supplier-record-list > button').count()) === 0) return;
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết nhà cung cấp' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trả nợ' })).toBeVisible();
    await page.locator('button[aria-label="Đóng chi tiết"]').click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết nhà cung cấp' })).toHaveCount(0);
  });
});
