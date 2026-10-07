import { test, expect, type Page } from '@playwright/test';

// Regression #1: phím tắt bán hàng (F1–F10) xuyên qua các overlay đang mở.
// Trước đó POSScreen chỉ chặn khi dimensionModalItem / receiptModalOrder / shiftModalOpen
// khác null, nên các sheet mới (giỏ hàng, thanh toán, quét mã, trung tâm đồng bộ) bị bỏ sót:
// bấm F10 lúc đang mở sheet giỏ sẽ checkout "dưới" sheet.
// Cách sửa: mọi overlay đều có role="dialog" + POSScreen kiểm tra DOM lúc phím được bấm.
//
// Regression #2: Alt + X đổi màn nhưng không đóng menu phân hệ -> menu phủ lên màn mới.
//
// Regression #3: in phiếu xoá document.title, chỉ khôi phục qua afterprint (không phát trên
// iOS Safari / WebView Android) -> tiêu đề tab trống vĩnh viễn.
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

const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id || '');

test.describe('phím tắt không xuyên qua overlay', () => {
  test('control: F4 vẫn chuyển focus sang ô khách hàng khi không mở overlay', async ({ page }) => {
    await loginAsCashier(page);
    await page.locator('#f1-search-input').click();
    await page.keyboard.press('F4');
    expect(await focusedId(page)).toBe('f4-customer-input');
  });

  test('F4 bị chặn khi sheet trung tâm đồng bộ đang mở', async ({ page }) => {
    await loginAsCashier(page);
    await page.click('#header-sync-center-btn');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('F4');
    expect(await focusedId(page)).not.toBe('f4-customer-input');
    await page.locator('[aria-label="Đóng trung tâm đồng bộ"]').first().click();
  });

  test('F4 bị chặn khi modal thêm khách hàng nhanh của POS đang mở', async ({ page }) => {
    await loginAsCashier(page);
    await page.click('#btn-quick-customer-modal');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('F4');
    expect(await focusedId(page)).not.toBe('f4-customer-input');
    await page.keyboard.press('Escape');
  });

  test('F12 mở modal ca: chặn khi đang mở overlay, mở lại được sau khi đóng', async ({ page }) => {
    await loginAsCashier(page);
    await page.click('#header-sync-center-btn');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('F12');
    await page.waitForTimeout(800);
    expect(await page.locator('#shift-modal-overlay').count()).toBe(0);

    await page.locator('[aria-label="Đóng trung tâm đồng bộ"]').first().click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press('F12');
    await expect(page.locator('#shift-modal-overlay')).toBeVisible({ timeout: 10_000 });
  });

  test('Alt + X đóng menu phân hệ khi chuyển màn', async ({ page }) => {
    await loginAsCashier(page);
    await page.click('#flyout-menu-trigger');
    await expect(page.locator('#flyout-overlay')).toBeVisible();
    await page.keyboard.press('Alt+p');
    await expect(page.locator('#flyout-overlay')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('#products-view')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('in phiếu: khôi phục tiêu đề tab', () => {
  // Tự dọn: bán 1 đơn rồi hủy qua UI (server hoàn kho/quỹ), chỉ còn bản ghi "Đã hủy".
  test('đóng modal phiếu khi afterprint không phát vẫn khôi phục document.title', async ({ page }) => {
    await loginAsCashier(page);
    const original = await page.title();
    expect(original).not.toBe('');

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
      if ((await page.locator('#cart-table-container tbody tr').count()) > 0) break;
    }
    expect(await page.locator('#cart-table-container tbody tr').count()).toBeGreaterThan(0);

    const payable = Number((await page.locator('#payable-total-display').innerText()).replace(/[^\d]/g, '')) || 0;
    expect(payable).toBeGreaterThan(0);
    await page.locator('#payment-method-cash').click();
    await page.locator('#f9-tendered-input').fill(String(payable + 100000));
    await page.locator('#btn-pos-checkout').click();
    await expect(page.locator('#receipt-modal-overlay')).toBeVisible({ timeout: 30_000 });
    const code = (await page.locator('#receipt-modal-container h3').innerText()).match(/HD-\d+-\d+/)?.[0];
    expect(code).toBeTruthy();

    // Mô phỏng iOS Safari / WebView Android: window.print() không bắn afterprint.
    await page.evaluate(() => {
      (window as unknown as { print: () => void }).print = () => {};
    });
    await page.click('#btn-print-receipt');
    await expect.poll(() => page.title()).toBe('');

    await page.locator('#receipt-modal-container button', { hasText: 'Đóng' }).first().click();
    await expect(page.locator('#receipt-modal-overlay')).toBeHidden({ timeout: 10_000 });
    await expect.poll(() => page.title()).toBe(original);

    // Dọn: hủy đơn vừa tạo
    await page.keyboard.press('Alt+m');
    await expect(page.locator('#flyout-overlay')).toBeVisible({ timeout: 10_000 });
    await page.locator('#menu-item-vouchers').click();
    await expect(page.locator('#orders-view')).toBeVisible({ timeout: 15_000 });
    await page.locator('#orders-view input[placeholder="Mã đơn, tên khách, SĐT..."]').fill(code!);
    const row = page.locator('#orders-view tbody tr', { hasText: code! }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await page.locator('#orders-view button', { hasText: 'Hủy hóa đơn & Hoàn quỹ' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Hủy đơn' }).click();
    await expect(page.locator('#orders-view span:text-is("Đã hủy")').first()).toBeVisible({ timeout: 30_000 });
  });
});
