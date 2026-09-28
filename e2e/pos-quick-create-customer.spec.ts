import { test, expect, type Page } from '@playwright/test';

// Ô tìm khách hàng / NCC phải có "tạo mới nhanh" giống ô tìm hàng hóa:
// dòng "Tạo ... mới" ở chân danh sách + Enter khi không có kết quả -> mở form, tên
// điền sẵn từ chuỗi đang gõ.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#network-status-toggle')).toContainText('Trực tiếp', { timeout: 30_000 });
  await page.waitForTimeout(6000);
}

test('ô khách hàng: gõ tên lạ + Enter mở form tạo nhanh, tên được điền sẵn', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');
  const name = 'KH Tạo Nhanh ' + Date.now().toString().slice(-5);

  try {
    await input.click();
    await input.fill(name);
    await expect(dropdown).toBeVisible({ timeout: 15_000 });
    // Dòng tạo nhanh hiện ở chân danh sách
    const quick = page.locator('#btn-quick-create-customer');
    await expect(quick).toBeVisible({ timeout: 10_000 });
    await expect(quick).toContainText(name);

    // Enter -> mở form tạo nhanh, tên điền sẵn, con trỏ nhảy sang ô SĐT
    await input.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#quick-cust-name')).toHaveValue(name);
    await expect(page.locator('#quick-cust-phone')).toBeFocused();
    console.log('MODAL_SEEDED=' + name);

    // Điền SĐT rồi lưu -> khách mới được gán vào giỏ
    await page.fill('#quick-cust-phone', '0912' + Date.now().toString().slice(-6));
    await page.click('#btn-confirm-save-quick-customer');
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(input).toHaveValue(name, { timeout: 15_000 });
    console.log('CREATED=' + name);
  } finally {
    // Dọn khách test: màn Khách hàng có nút xóa + hộp xác nhận
    await page.keyboard.press('Alt+m');
    await page.locator('#menu-item-customers').click();
    await expect(page.locator('#customers-view')).toBeVisible({ timeout: 20_000 });
    await page.locator('#customers-view input[placeholder*="Tìm theo"]').first().fill(name);
    const row = page.locator('#customers-view tbody tr', { hasText: name }).first();
    if ((await row.count().catch(() => 0)) > 0) {
      await row.click();
      await page.locator('#customers-view button[title="Xóa khách hàng"]').first().click().catch(() => {});
      const dlg = page.getByRole('alertdialog');
      if ((await dlg.count().catch(() => 0)) > 0) await dlg.getByRole('button').last().click().catch(() => {});
    }
  }
});

test('ô khách hàng: khi ĐÃ có kết quả thì Enter vẫn chọn khách, không mở form tạo mới', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');

  await input.click();
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });
  const rows = dropdown.locator(':scope > div');
  const count = await rows.count();
  test.skip(count < 2, 'cần ít nhất 1 khách để kiểm tra Enter chọn khách');

  await input.press('Enter');
  // Chọn xong thì dropdown đóng, form tạo nhanh KHÔNG mở
  await expect(dropdown).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ô NCC trong luồng Nhập hàng: dòng tạo nhanh mở form thêm NCC, tên điền sẵn', async ({ page }) => {
  const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
  const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', ADMIN_ID);
  await page.fill('#login-password-input', ADMIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(5000);

  await page.locator('#pos-goods-toolbar button', { hasText: 'Nhập hàng' }).first().click();
  await page.waitForTimeout(2000);

  const trigger = page.locator('input[placeholder*="tìm NCC"]').first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const name = 'NCC Tạo Nhanh ' + Date.now().toString().slice(-5);
  await trigger.fill(name);
  const list = page.locator('ul[role="listbox"]');
  await expect(list).toBeVisible({ timeout: 10_000 });

  // Dòng tạo nhanh hiện ở chân danh sách
  const quick = page.locator('#btn-quick-create-option');
  await expect(quick).toBeVisible({ timeout: 10_000 });
  await expect(quick).toContainText(name);
  await expect(quick).toContainText('Tạo nhà cung cấp mới');

  // Bấm dòng -> mở form thêm NCC nhanh, tên điền sẵn
  await quick.click();
  const nameInput = page.locator('#quick-sup-name-input');
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  await expect(nameInput).toHaveValue(name);
  console.log('SUPPLIER_SEEDED=' + name);
  // Không lưu: đóng form để không để lại rác trong DB
  await page.keyboard.press('Escape');
});
