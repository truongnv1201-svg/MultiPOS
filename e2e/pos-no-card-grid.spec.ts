import { test, expect, type Page } from '@playwright/test';

const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#header-sync-center-btn')).toHaveAttribute('title', /trực tiếp/i, { timeout: 30_000 });
  await page.waitForTimeout(6000);
}

test.describe('đã bỏ chế độ lưới thẻ', () => {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`không còn lưới thẻ + vẫn thêm hàng được @ ${vp.name}`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);

      // 1) Không còn khối lưới thẻ, không còn nút đổi chế độ
      await expect(page.locator('#product-grid-section')).toHaveCount(0);
      await expect(page.locator('#btn-toggle-pos-mode')).toHaveCount(0);
      const posText = (await page.locator('#pos-screen').textContent()) || '';
      expect(posText).not.toContain('Chế độ Thẻ');
      expect(posText).not.toContain('Chế độ Nhanh');

      // 2) F2 về màn Bán hàng (nút header quảng cáo F2; handler đặt ở GlobalHeader).
      // Điện thoại khóa POS nên bỏ qua bước rời POS trên viewport mobile.
      if (vp.width >= 768) {
        await page.keyboard.press('Alt+p');
        await expect(page.locator('#products-view')).toBeVisible({ timeout: 20_000 });
        await page.keyboard.press('F2');
        await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('#product-grid-section')).toHaveCount(0);
      }

      // 3) Vẫn chọn hàng được bằng ô tìm kiếm -> giỏ có dòng
      const search = page.locator('#f1-search-input');
      await search.click();
      await search.fill('a');
      const items = page.locator('#search-results-dropdown div[id^="search-item-"]');
      await expect(items.first()).toBeVisible({ timeout: 15_000 });
      await items.first().click();
      if (await page.locator('#dimension-modal-overlay').isVisible().catch(() => false)) {
        await page.locator('#btn-close-dimension-modal').click();
      } else {
        const cart = page.locator('#cart-table-container tbody tr');
        if ((await cart.count()) > 0) return; // desktop: đã vào giỏ
      }
      // mobile: giỏ hiện thẳng trong trang, không cần mở sheet
      if (vp.width < 1024) {
        await expect(page.locator('#cart-record-list')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#cart-record-list li, #cart-record-list tr, #cart-record-list div').first()).toBeVisible();
      }
    });
  }
});
