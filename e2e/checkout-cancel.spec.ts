import { test, expect, type Page } from '@playwright/test';

// P5: vòng đời đơn thật trên backend live — bán (cash) → hủy qua UI.
// Tự dọn: đơn bị hủy + hoàn kho/hoàn quỹ do server (cancel_order) xử lý,
// chỉ còn bản ghi "Đã hủy" + bút toán hoàn (đúng nghiệp vụ kiểm toán).
// Chạy sau khi đã mở ca; nếu ca đóng, spec tự mở ca mới.
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

async function ensureShiftOpen(page: Page) {
  // Trạng thái ca hydrate async từ server: form mở/đóng có thể flip sau khi modal hiện.
  // Chờ ổn định rồi quyết định, retry khi flip đúng lúc click.
  const overlay = page.locator('#shift-modal-overlay');
  const openBtn = page.locator('#btn-confirm-open-shift');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('#header-shift-btn').click();
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);
    const needsOpen = await openBtn.isVisible().catch(() => false);
    if (!needsOpen) {
      if (await overlay.isVisible().catch(() => false)) {
        await page.locator('#shift-modal-container button').first().click().catch(() => {});
      }
      return;
    }
    try {
      await openBtn.click({ timeout: 8000 });
      await expect(overlay).toBeHidden({ timeout: 15_000 });
      return;
    } catch {
      // Flip giữa chừng -> vòng sau đọc lại trạng thái mới.
    }
  }
  throw new Error('không ổn định được trạng thái ca sau 3 lần thử');
}

async function addGoodsToCart(page: Page) {
  const search = page.locator('#f1-search-input');
  const cartRows = page.locator('#cart-table-container tbody tr');
  for (const term of ['a', 'e', 'o', '0', '1', 'k']) {
    await search.fill(term);
    try {
      await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
    } catch {
      continue;
    }
    // Bỏ qua mặt hàng hết tồn: server chặn bán khi tồn sẽ âm (check constraint
    // products_stock_quantity_check) -> pos_checkout trả 400 và test fail nhầm thành
    // lỗi ứng dụng. Dropdown có hiện "Tồn: N <đơn vị>".
    const items = page.locator('#search-results-dropdown div[id^="search-item-"]').filter({ hasNotText: /Tồn:\s*0(?!\d)/ });
    const n = Math.min(await items.count(), 4);
    for (let i = 0; i < n; i++) {
      await items.nth(i).click();
      // Hàng m² mở modal F3 thay vì vào giỏ -> đóng, thử món khác.
      const modal = page.locator('#dimension-modal-overlay');
      if (await modal.isVisible()) {
        await page.locator('#btn-close-dimension-modal').click();
        await search.fill(term);
        try {
          await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
        } catch {
          break;
        }
        continue;
      }
      if ((await cartRows.count().catch(() => 0)) > 0) return;
    }
  }
  throw new Error('không thêm được hàng goods nào vào giỏ');
}

test.describe('checkout -> hủy (live, tự dọn)', () => {
  test('bán cash đủ tiền rồi hủy, đơn về trạng thái Đã hủy', async ({ page }) => {
    await loginAsCashier(page);
    await ensureShiftOpen(page);
    await addGoodsToCart(page);

    const payableText = await page.locator('#payable-total-display').innerText();
    const payable = Number(payableText.replace(/[^\d]/g, '')) || 0;
    expect(payable).toBeGreaterThan(0);
    await page.locator('#payment-method-cash').click();
    await page.locator('#f9-tendered-input').fill(String(payable + 100000));
    await page.locator('#btn-pos-checkout').click();

    await expect(page.locator('#receipt-modal-overlay')).toBeVisible({ timeout: 30_000 });
    const title = await page.locator('#receipt-modal-container h3').innerText();
    const code = title.match(/HD-\d+-\d+/)?.[0];
    expect(code).toBeTruthy();
    await page.locator('#receipt-modal-container button', { hasText: 'Đóng' }).click();
    await expect(page.locator('#receipt-modal-overlay')).toBeHidden({ timeout: 10_000 });
    // Đơn mới phải trắng khách hàng (không dính tên KH đơn cũ).
    await expect(page.locator('#f4-customer-input')).toHaveValue('Khách Lẻ Mua Tại Quầy', { timeout: 10_000 });

    // Sang Đơn hàng, tìm đúng đơn vừa bán rồi hủy.
    await page.keyboard.press('Alt+m');
    await expect(page.locator('#flyout-overlay')).toBeVisible({ timeout: 10_000 });
    await page.locator('#menu-item-vouchers').click();
    await expect(page.locator('#orders-view')).toBeVisible({ timeout: 15_000 });
    await page.locator('#orders-view input[placeholder="Mã đơn, tên khách, SĐT..."]').fill(code!);
    // Chờ filter hội tụ đúng 1 dòng (realtime re-render có thể reset giữa chừng) rồi
    // scope mọi assert sau vào dòng này — không dùng badge "Đã hủy" đầu tiên toàn view
    // (chạy chung suite có nhiều đơn hủy của spec khác).
    const rows = page.locator('#orders-view tbody tr', { hasText: code! });
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    const row = rows.first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.locator('#orders-view').getByText(code!, { exact: false }).last()).toBeVisible();
    await page.locator('#orders-view button', { hasText: 'Hủy hóa đơn & Hoàn quỹ' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Hủy đơn' }).click();
    await expect(row.getByText('Đã hủy')).toBeVisible({ timeout: 30_000 });
  });
});
