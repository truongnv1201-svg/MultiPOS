import { test, expect, type Page } from '@playwright/test';

// P2: trạng thái mạng + thao tác đồng bộ phản ứng đúng khi mất/có mạng.
// Giai đoạn 3: nút "Làm mới" rời đã bỏ, thao tác kéo số liệu nằm trong Trung tâm đồng bộ
// (nút #header-sync-center-btn -> "Đồng bộ ngay" -> refreshNow).
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
  test('mất mạng → Offline + khóa đồng bộ trong Trung tâm; có mạng lại → Online', async ({ page, context }) => {
    await loginAsCashier(page);
    const net = page.locator('#network-status-toggle');
    await expect(net).toContainText(/Online|Trực tiếp/, { timeout: 30_000 });

    await page.locator('#header-sync-center-btn').click();
    const syncNow = page.getByRole('button', { name: 'Đồng bộ ngay' });
    await expect(syncNow).toBeEnabled();

    await context.setOffline(true);
    await expect(net).toContainText('Offline', { timeout: 10_000 });
    await expect(syncNow).toBeDisabled();

    await context.setOffline(false);
    await expect(net).toContainText(/Online|Trực tiếp/, { timeout: 30_000 });
    await expect(syncNow).toBeEnabled({ timeout: 30_000 });
  });

  test('đồng bộ trong Trung tâm không crash, badge/tiêu đề cập nhật', async ({ page }) => {
    await loginAsCashier(page);
    await page.locator('#header-sync-center-btn').click();
    const syncNow = page.getByRole('button', { name: 'Đồng bộ ngay' });
    await expect(syncNow).toBeEnabled({ timeout: 30_000 });
    await syncNow.click();
    // Sync chạy nền: app vẫn đứng ở POS, sheet không kẹt vì lỗi.
    await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Trung tâm đồng bộ' })).toBeVisible();
  });

  test('nút Làm mới rời đã bỏ, thay bằng nút Trung tâm đồng bộ', async ({ page }) => {
    await loginAsCashier(page);
    await expect(page.locator('#header-refresh-btn')).toHaveCount(0);
    await expect(page.locator('#header-sync-center-btn')).toBeVisible();
  });
});
