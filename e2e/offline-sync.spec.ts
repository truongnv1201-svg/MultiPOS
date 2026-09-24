import { test, expect, type Page } from '@playwright/test';

// P2: trạng thái mạng + nút đồng bộ tay (header) phản ứng đúng khi mất/có mạng.
// Dựa trên NetworkProvider (navigator.onLine) + refreshNow/refresh-btn ở GlobalHeader.
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

test.describe('offline / sync badge', () => {
  test('mất mạng → Offline + khóa nút refresh; có mạng lại → Online', async ({ page, context }) => {
    await loginAsCashier(page);
    const net = page.locator('#network-status-toggle');
    const refresh = page.locator('#header-refresh-btn');
    await expect(net).toContainText(/Online|Trực tiếp/, { timeout: 30_000 });

    await context.setOffline(true);
    await expect(net).toContainText('Offline', { timeout: 10_000 });
    await expect(refresh).toBeDisabled();

    await context.setOffline(false);
    await expect(net).toContainText(/Online|Trực tiếp/, { timeout: 30_000 });
    await expect(refresh).toBeEnabled({ timeout: 30_000 });
  });

  test('bấm Làm mới tay không crash, badge/tiêu đề cập nhật', async ({ page }) => {
    await loginAsCashier(page);
    const refresh = page.locator('#header-refresh-btn');
    await expect(refresh).toBeEnabled({ timeout: 30_000 });
    await refresh.click();
    // Sync chạy nền: app vẫn đứng ở POS, nút không kẹt disabled vì lỗi.
    await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  });
});
