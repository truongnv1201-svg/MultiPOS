import { test, expect, type Page } from '@playwright/test';

// Nút "Dọn sạch dữ liệu máy trạm" (Cài đặt, chỉ Admin): bấm -> xác nhận ->
// reload -> marker project được ghi. Profile test trống nên dọn trên trống,
// không đụng dữ liệu thật (net-zero).

const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'NV0001';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || '123456';

async function loginAdmin(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', ADMIN_ID);
  await page.fill('#login-password-input', ADMIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
}

test.describe('Cài đặt: dọn máy trạm khi đổi project', () => {
  test('nút dọn hiện với Admin, bấm + xác nhận thì reload và ghi marker', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 950 });
    await loginAdmin(page);

    await page.keyboard.press('Alt+s');
    await expect(page.locator('#settings-view')).toBeVisible({ timeout: 20_000 });

    const wipe = page.getByRole('button', { name: 'Dọn sạch dữ liệu máy trạm' });
    await expect(wipe).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await wipe.click();
    // Handler reload sau 500ms — app mở lại đúng màn hình cũ (Cài đặt)
    await page.waitForTimeout(1500);
    await expect(page.locator('#settings-view')).toBeVisible({ timeout: 30_000 });

    const marker = await page.evaluate(() => localStorage.getItem('multipos_project_url'));
    expect(marker).toContain('supabase.co');
  });
});
