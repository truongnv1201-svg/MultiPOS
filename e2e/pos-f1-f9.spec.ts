import { test, expect, type Page } from '@playwright/test';

// POS: huy hiệu F1 ở ô tìm hàng + F9 hai nhịp (nhảy tới ô tiền, bấm nữa điền đủ tiền).
//
// Chỉ thêm hàng vào giỏ LOCAL, không bấm THANH TOÁN nên không ghi DB — net-zero,
// chạy được trên DB live dùng chung. Cuối test xóa giỏ để trả màn hình sạch.

const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function loginCashier(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
}

const digits = (s: string) => (s || '').replace(/\D/g, '');

test.describe('POS: phím tắt F1 / F9', () => {
  test('F1 focus ô tìm hàng; F9 nhảy tới ô tiền, bấm nữa điền đủ tiền', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 950 });
    await loginCashier(page);

    // 1) Ô tìm hàng hiện huy hiệu F1 để user mới biết
    await expect(page.locator('#f1-search-input + kbd, #f1-search-input ~ kbd').first()).toContainText('F1');

    // 2) Bấm F1 từ nơi khác (ô ghi chú) phải nhảy focus về ô tìm hàng
    await page.locator('textarea[placeholder*="Ghi chú đơn hàng"]').click();
    await page.keyboard.press('F1');
    await expect(page.locator('#f1-search-input')).toBeFocused();

    // 3) Thêm 1 món HÀNG THƯỜNG vào giỏ local (click trúng hàng m2 sẽ mở modal
    // F3 thay vì vào giỏ — đóng modal rồi chọn món khác)
    const search = page.locator('#f1-search-input');
    await search.click();
    await search.fill('keo');
    const items = page.locator('#search-results-dropdown div[id^="search-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < 5; i++) {
      await items.nth(i).click();
      await page.waitForTimeout(800);
      if (await page.locator('#dimension-modal-overlay').isVisible().catch(() => false)) {
        await page.locator('#btn-close-dimension-modal').click();
        await search.click();
        await search.fill('keo');
        await expect(items.first()).toBeVisible({ timeout: 15_000 });
        continue;
      }
      break;
    }
    await expect(page.locator('#cart-table-container tbody tr').first()).toBeVisible({ timeout: 15_000 });

    // 4) F9 nhịp 1: nhảy tới ô tiền khách đưa
    await page.keyboard.press('F9');
    await expect(page.locator('#f9-tendered-input')).toBeFocused();

    // 5) F9 nhịp 2: điền đúng số KHÁCH CẦN TRẢ (span tiền trong nút THANH TOÁN —
    // lấy đúng span để khỏi nuốt số trong chữ "F10")
    const payableText = (await page.locator('#btn-pos-checkout span').nth(1).textContent()) || '';
    await page.keyboard.press('F9');
    await page.waitForTimeout(500);
    const tendered = await page.locator('#f9-tendered-input').inputValue();
    expect(digits(tendered)).toBe(digits(payableText));
    expect(digits(tendered).length).toBeGreaterThan(0);
  });
});
