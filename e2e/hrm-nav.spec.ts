import { test, expect, type Page } from '@playwright/test';

// P5: HRM điều hướng chỉ đọc (không tạo/sửa/chốt gì trên DB live).
// Flow destructive (chấm → lập bảng → chốt → chi) đã có unit scripts/hrm.test.mjs
// phủ công thức; e2e destructive chỉ chạy trên project trắng riêng.
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

async function gotoHrm(page: Page) {
  await page.keyboard.press('Alt+m');
  await expect(page.locator('#flyout-overlay')).toBeVisible({ timeout: 10_000 });
  await page.locator('#menu-item-hr').click();
  await expect(page.locator('#hrm-view')).toBeVisible({ timeout: 15_000 });
}

test.describe('HRM điều hướng (chỉ đọc)', () => {
  test('3 tabs Tổng quan / Nhân sự / Chấm công & Lương đều render', async ({ page }) => {
    await loginAsCashier(page);
    await gotoHrm(page);
    const tabs = page.locator('#hrm-view [role="tablist"] [role="tab"]');
    await expect(tabs).toHaveCount(3, { timeout: 15_000 });
    for (const name of ['Tổng quan', 'Nhân sự', 'Chấm công & Lương']) {
      await page.locator('#hrm-view [role="tab"]').getByText(name, { exact: false }).click();
      await expect(page.locator('#hrm-view')).toBeVisible();
    }
  });
});
