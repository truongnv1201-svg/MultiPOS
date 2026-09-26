import { test, expect, type Page } from '@playwright/test';

// Regression: các ô tìm kiếm có dropdown phải đóng khi bấm ra ngoài
// (trước đó dropdown tìm hàng hóa và tìm khách hàng bị kẹt mở, che giỏ hàng).
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

// Vùng trung tính để bấm ra ngoài (logo — bấm chỉ chuyển về POS, không đổi dữ liệu)
const NEUTRAL_TARGET = '#app-branding';

test.describe('đóng dropdown khi bấm ra ngoài', () => {
  test('tìm hàng hóa: mở dropdown rồi bấm ra ngoài thì đóng', async ({ page }) => {
    await loginAsCashier(page);
    const search = page.locator('#f1-search-input');
    const dropdown = page.locator('#search-results-dropdown');

    await search.fill('a');
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    await page.locator(NEUTRAL_TARGET).click();
    await expect(dropdown).toHaveCount(0, { timeout: 5_000 });
  });

  test('tìm khách hàng: mở dropdown rồi bấm ra ngoài thì đóng', async ({ page }) => {
    await loginAsCashier(page);
    const input = page.locator('#f4-customer-input');
    const dropdown = page.locator('#customer-search-dropdown');

    await input.click();
    await input.fill('a');
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    await page.locator(NEUTRAL_TARGET).click();
    await expect(dropdown).toHaveCount(0, { timeout: 5_000 });
  });

  test('tìm khách hàng: Escape cũng đóng dropdown', async ({ page }) => {
    await loginAsCashier(page);
    const input = page.locator('#f4-customer-input');
    const dropdown = page.locator('#customer-search-dropdown');

    await input.click();
    await input.fill('a');
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    await input.press('Escape');
    await expect(dropdown).toHaveCount(0, { timeout: 5_000 });
  });

  test('ô khách hàng: gõ không bị dính chữ vào tên khách đã chọn', async ({ page }) => {
    await loginAsCashier(page);
    const input = page.locator('#f4-customer-input');
    const dropdown = page.locator('#customer-search-dropdown');

    // Chọn 1 khách trước để ô có tên hiển thị sẵn (lấy tên từ dữ liệu thật, không hardcode)
    await input.click();
    await input.fill('a');
    const firstRow = dropdown.locator('> div').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    const pickedName = (await firstRow.innerText()).split('\n')[0].trim();
    await firstRow.click();
    await expect(input).toHaveValue(pickedName, { timeout: 10_000 });

    // Bấm lại vào ô rồi gõ: ký tự phải thay cả tên, không nối vào cuối tên
    await input.click();
    await page.keyboard.type('a', { delay: 40 });
    await expect(input).toHaveValue('a', { timeout: 5_000 });
    await expect(dropdown.locator('> div').first()).toBeVisible();
  });

  test('dropdown tìm hàng giữ nguyên chiều cao khi gõ từng ký tự', async ({ page }) => {
    await loginAsCashier(page);
    const search = page.locator('#f1-search-input');
    const dropdown = page.locator('#search-results-dropdown');

    await search.click();
    const heights: number[] = [];
    for (const ch of ['k', 'e', 'o']) {
      await page.keyboard.type(ch, { delay: 60 });
      await expect(dropdown).toBeVisible({ timeout: 10_000 });
      const box = await dropdown.boundingBox();
      heights.push(Math.round(box?.height ?? 0));
    }
    // Không nhảy: chiều cao khung gợi ý phải giữ nguyên khi số kết quả thay đổi
    expect(new Set(heights).size).toBe(1);
  });

  test('điện thoại: danh sách gợi ý khách trong sheet thanh toán đóng khi bấm ra ngoài', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsCashier(page);

    // Cần ít nhất 1 món thì nút thanh toán mới bật (ưu tiên hàng thường để thêm thẳng giỏ)
    const search = page.locator('#f1-search-input');
    let added = false;
    for (const term of ['keo', 'đinh', 'ghe', 'a', 'e', 'o', '0', '1']) {
      await search.fill(term);
      try {
        await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
        await page.locator('#search-results-dropdown div[id^="search-item-"]').first().click();
        await expect(page.locator('#btn-pos-mobile-cart-summary')).toBeVisible({ timeout: 10_000 });
        added = true;
        break;
      } catch {
        if ((await page.locator('#dimension-modal-overlay').count()) > 0) {
          await page.locator('#btn-cancel-dimension-modal').click().catch(() => {});
        }
        continue;
      }
    }
    expect(added).toBe(true);

    await page.locator('#btn-pos-mobile-payment').click();
    const sheet = page.getByRole('dialog', { name: 'Thanh toán' });
    await expect(sheet).toBeVisible();

    await page.locator('#mobile-payment-customer-input').fill('a');
    const list = page.locator('#mobile-payment-customer-list');
    await expect(list).toBeVisible();

    // Bấm vào khối tổng tiền (trung tính, trong sheet) để đóng danh sách
    await sheet.getByText('KHÁCH CẦN TRẢ').click();
    await expect(list).toHaveCount(0, { timeout: 5_000 });

    await sheet.locator('button[aria-label="Đóng thanh toán"]').first().click();
  });
});
