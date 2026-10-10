import { test, expect, type Page } from '@playwright/test';

// Smoke Giai đoạn 2 trên viewport điện thoại: bảng ngang phải được thay bằng
// record list / bottom sheet (cart sheet, kho, NCC) và Sync Center mở được.
// Tài khoản seed từ scripts/seed-users.mjs; override qua env khi cần.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

const PHONE_VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
];

async function loginAsCashier(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

async function loginAsAdmin(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', ADMIN_ID);
  await page.fill('#login-password-input', ADMIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

test.describe('POS mobile (live backend)', () => {
  for (const vp of PHONE_VIEWPORTS) {
    test(`giỏ inline + thanh toán ghim đáy @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAsCashier(page);

      // Bảng giỏ ngang phải ẩn trên mobile (record list thay thế)
      await expect(page.locator('#cart-table-container table')).toBeHidden();

      // Thêm 1 hàng vào giỏ (hàng m2 đi qua modal F3 → xác nhận luôn) — dòng hiện
      // thẳng trong trang, không còn nút tóm tắt / sheet tách rời
      const search = page.locator('#f1-search-input');
      let added = false;
      for (const term of ['a', 'e', 'o', '0', '1', 'k']) {
        await search.fill(term);
        try {
          await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
          // Bỏ qua mặt hàng hết tồn (server chặn bán khi tồn âm -> pos_checkout 400).
          await page
            .locator('#search-results-dropdown div[id^="search-item-"]')
            .filter({ hasNotText: /Tồn:\s*0(?!\d)/ })
            .first()
            .click();
          const f3 = page.locator('#dimension-modal-overlay');
          if ((await f3.count()) > 0) {
            await page.locator('#btn-confirm-dimension-modal').click();
            await expect(page.locator('#dimension-modal-overlay')).toHaveCount(0);
          }
          await expect(page.locator('#btn-pos-mobile-cart-summary')).toHaveCount(0);
          added = true;
          break;
        } catch {
          if ((await page.locator('#dimension-modal-overlay').count()) > 0) {
            await page.locator('#btn-cancel-dimension-modal').click();
          }
          continue;
        }
      }
      expect(added).toBe(true);

      // Dòng giỏ hiện thẳng trong #cart-record-list: sửa được SL, xóa được
      const list = page.locator('#cart-record-list');
      await expect(list).toBeVisible({ timeout: 10_000 });
      await expect(list.locator(':scope > div').first()).toBeVisible({ timeout: 10_000 });
      await expect(list.locator('input[aria-label^="Số lượng"], button[aria-label^="Xóa "]').first()).toBeVisible();

      // Thanh toán ghim đáy màn hình (thay dock đã bỏ)
      const payBtn = page.locator('#btn-pos-mobile-payment');
      await expect(payBtn).toBeVisible();
      const payBox = await payBtn.boundingBox();
      expect((payBox?.y ?? 0) + (payBox?.height ?? 0)).toBeGreaterThan(vp.height - 120);

      // Thanh toán ghim mở sheet: đổi phương thức, nhập tiền khách đưa, đóng lại được
      await payBtn.click();
      const payDialog = page.getByRole('dialog', { name: 'Thanh toán' });
      await expect(payDialog).toBeVisible();
      await expect(payDialog.getByRole('button', { name: 'Tiền mặt' })).toBeVisible();
      await expect(page.locator('#mobile-payment-tendered-input')).toBeVisible();
      await expect(page.locator('#btn-pos-mobile-payment-confirm')).toBeVisible();
      await payDialog.locator('button[aria-label="Đóng thanh toán"]').first().click();
      await expect(payDialog).toHaveCount(0);

      // Sync Center mở được từ header và đóng lại được
      await page.locator('#header-sync-center-btn').click();
      await expect(page.getByRole('dialog', { name: 'Trung tâm đồng bộ' })).toBeVisible();
      await page.locator('button[aria-label="Đóng trung tâm đồng bộ"]').first().click();
      await expect(page.getByRole('dialog', { name: 'Trung tâm đồng bộ' })).toHaveCount(0);
    });
  }

  test('kho + NCC dùng record list, mở sheet chi tiết NCC @ tablet 768x1024 (điện thoại khóa POS)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsAdmin(page);

    // Kho: Alt+N là phân hệ bị chặn với cashier, admin đi qua menu phân hệ
    await page.keyboard.press('Alt+n');
    await expect(page.locator('#inventory-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#movement-record-list')).toBeVisible();

    // NCC: Alt+K
    await page.keyboard.press('Alt+k');
    await expect(page.locator('#suppliers-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#supplier-record-list')).toBeVisible();
    await expect(page.locator('#supplier-record-list table')).toHaveCount(0);

    const firstRow = page.locator('#supplier-record-list > button').first();
    if ((await page.locator('#supplier-record-list > button').count()) === 0) return;
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết nhà cung cấp' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trả nợ' })).toBeVisible();
    await page.locator('button[aria-label="Đóng chi tiết"]').click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết nhà cung cấp' })).toHaveCount(0);
  });

  test('trả nợ NCC dạng sheet + card offline trong Cài đặt @ tablet 768x1024 (điện thoại khóa POS)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsAdmin(page);

    await page.keyboard.press('Alt+k');
    await expect(page.locator('#suppliers-view')).toBeVisible({ timeout: 30_000 });
    if ((await page.locator('#supplier-record-list > button').count()) === 0) return;

    await page.locator('#supplier-record-list > button').first().click();
    const trảNợ = page.getByRole('button', { name: 'Trả nợ' });
    if (await trảNợ.isDisabled()) return;
    await trảNợ.click();
    const paySheet = page.getByRole('dialog', { name: 'Phiếu chi trả nợ nhà cung cấp' });
    await expect(paySheet).toBeVisible();
    await expect(page.locator('#btn-confirm-pay-supplier')).toBeVisible();
    await paySheet.locator('button[aria-label="Đóng cửa sổ"]').first().click();
    await expect(paySheet).toHaveCount(0);

    // Cài đặt: card trạng thái offline báo số mặt hàng/KH/NCC đã cache
    await page.keyboard.press('Alt+s');
    await expect(page.locator('#settings-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#btn-check-app-update')).toBeVisible();
    await expect(page.getByText('Hàng hóa đã cache')).toBeVisible();
  });

  test('bảng giá + khách hàng dùng record list, mở sheet chi tiết KH @ tablet 768x1024 (điện thoại khóa POS)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsAdmin(page);

    // Bảng giá (Alt+P)
    await page.keyboard.press('Alt+p');
    await expect(page.locator('#products-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#product-record-list')).toBeVisible();
    await expect(page.locator('#product-record-list table')).toHaveCount(0);

    // Khách hàng: qua menu phân hệ
    await page.keyboard.press('Alt+c');
    await expect(page.locator('#customers-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#customer-record-list')).toBeVisible();
    await expect(page.locator('#customer-record-list table')).toHaveCount(0);

    const rows = page.locator('#customer-record-list > button');
    if ((await rows.count()) === 0) return;
    await rows.first().click();
    const detail = page.getByRole('dialog', { name: 'Chi tiết khách hàng' });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Thu nợ' })).toBeVisible();
    await page.locator('button[aria-label="Đóng chi tiết khách"]').click();
    await expect(detail).toHaveCount(0);
  });

  test('mở tab in từ tablet được (biên nhận + bảng in) @ 768x1024 (điện thoại khóa POS)', async ({ page, context }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsCashier(page);

    // In bảng: nút In của TableTools mở tab in (blob) thay vì auto-print iframe
    await page.keyboard.press('Alt+p');
    await expect(page.locator('#products-view')).toBeVisible({ timeout: 30_000 });
    const printBtn = page.locator('button[title="In bảng đang xem"]').first();
    await expect(printBtn).toBeVisible();
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15_000 }), printBtn.click()]);
    await expect(popup.locator('#mp-print-now')).toBeVisible({ timeout: 15_000 });
    await expect(popup.locator('body')).toContainText(/DANH MỤC HÀNG HÓA/i);
    await popup.close();
  });
});
