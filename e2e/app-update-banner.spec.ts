import { test, expect, type Page } from '@playwright/test';

// Banner "Có bản mới": client lưu SHA deploy lần đầu, lần sau khác nhau là báo.
// Giả lập deploy mới bằng cách chặn /api/version: lần đầu trả SHA cũ, sau đó
// trả SHA mới. Không ghi DB (net-zero).

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

test.describe('banner bản mới theo SHA deploy', () => {
  test('SHA đổi thì hiện banner, Để sau thì ẩn và không báo lại', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 950 });

    let calls = 0;
    await page.route('**/api/version', async (route) => {
      calls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sha: calls <= 1 ? 'build-aaa' : 'build-bbb' }),
      });
    });

    await loginAdmin(page);
    await expect.poll(() => calls, { timeout: 20_000 }).toBeGreaterThan(0);

    // Chưa đổi SHA -> chưa có banner
    await expect(page.getByText('Có bản mới — tải lại để nhận sửa lỗi.')).toHaveCount(0);

    // Giả vờ quay lại tab sau khi đã deploy (SHA mới) -> banner hiện
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const banner = page.getByText('Có bản mới — tải lại để nhận sửa lỗi.');
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // Để sau -> ẩn và không báo lại cho cùng SHA mới
    await page.getByRole('button', { name: 'Để sau' }).click();
    await expect(banner).toHaveCount(0);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1500);
    await expect(banner).toHaveCount(0);
  });
});
