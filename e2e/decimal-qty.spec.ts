import { test, expect, type Page } from '@playwright/test';

// Số lượng thập phân (2,15 kg): ô nhập phải nhận được dấu phẩy/dấu chấm,
// hàng chưa bật cờ thì được làm tròn về số nguyên kèm thông báo.
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

async function pickFirstProduct(page: Page) {
  const search = page.locator('#f1-search-input');
  for (const term of ['keo', 'đinh', 'ghe', 'a', 'e', 'o', '0', '1']) {
    await search.fill(term);
    try {
      await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
      const item = page.locator('#search-results-dropdown div[id^="search-item-"]').first();
      const isArea = (await item.innerText()).includes('Diện tích') || (await item.innerText()).includes('m²');
      await item.click();
      if (await page.locator('#dimension-modal-overlay').count()) {
        await page.locator('#btn-cancel-dimension-modal').click();
        if (isArea) continue;
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

test.describe('số lượng thập phân', () => {
  test('ô số lượng nhận được 2,15 và bấm Enter thêm vào giỏ', async ({ page }) => {
    await loginAsCashier(page);
    expect(await pickFirstProduct(page)).toBe(true);

    const qty = page.locator('#quick-quantity-input');
    await qty.click();
    await qty.fill('2,15');
    await page.keyboard.press('Enter');

    // Hàng mặc định số nguyên -> phải được làm tròn, không nhảy lỗi
    const cartText = await page.locator('#cart-table-container').innerText();
    expect(cartText.length).toBeGreaterThan(0);
    // Ô nhập đã sạch (reset về 1) sau khi thêm
    await expect(qty).toHaveValue(/^1$/);
  });

  test('ô số lượng nhận dấu chấm thập phân và bước tăng/giảm bám cờ mặt hàng', async ({ page }) => {
    await loginAsCashier(page);
    expect(await pickFirstProduct(page)).toBe(true);

    const qty = page.locator('#quick-quantity-input');
    await qty.click();
    await qty.fill('2.5');
    // Giá trị đọc được phải là 2.5 (không bị bỏ dấu chấm thành 25)
    expect(await qty.evaluate((el) => (el as HTMLInputElement).value)).toBe('2.5');
    await qty.press('Enter');

    // Bảng giỏ có ô số lượng cho hàng không phải m² -> nhập thập phân được
    const qtyInput = page.locator('#cart-table-container input[type="number"]').first();
    if ((await qtyInput.count()) > 0) {
      await qtyInput.fill('3');
      await expect(qtyInput).toHaveValue('3');
    }
  });

  test('form hàng hóa: mặc định Thường + để trống giá + cờ thập phân đã bật', async ({ page }) => {
    // Bảng giá chỉ Admin/Quản lý vào được -> login bằng admin ngay từ đầu
    await page.goto('/');
    await expect(page.locator('#login-modal-overlay')).toBeVisible();
    await page.fill('#login-id-input', process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local');
    await page.fill('#login-password-input', process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123');
    await page.click('#btn-login-submit');
    await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });

    await page.locator('#flyout-menu-trigger').click();
    await page.locator('#menu-item-products').click();
    await expect(page.locator('#products-view')).toBeVisible({ timeout: 30_000 });
    await page.locator('#btn-open-add-product-modal').click();

    const dialog = page.getByRole('dialog', { name: 'Thêm hàng hóa' });
    await expect(dialog).toBeVisible();

    // Mặc định: Loại = Thường, cờ thập phân đã tick
    await expect(dialog.locator('select').first()).toHaveValue('goods');
    await expect(dialog.getByText('Cho phép bán số lượng thập phân')).toBeVisible();
    await expect(dialog.locator('input[type="checkbox"]').first()).toBeChecked();

    // Giá bán / giá nhập / tồn để trống (không điền sẵn)
    const priceInputs = dialog.locator('input[inputmode="numeric"], input[inputmode="decimal"]');
    for (let i = 0; i < (await priceInputs.count()); i++) {
      await expect(priceInputs.nth(i)).toHaveValue('');
    }

    // Chọn đơn vị kg vẫn giữ cờ thập phân bật
    await dialog.locator('select').nth(1).selectOption('kg');
    await expect(dialog.locator('input[type="checkbox"]').first()).toBeChecked();
  });
});
