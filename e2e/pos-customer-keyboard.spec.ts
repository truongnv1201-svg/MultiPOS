import { test, expect, type Page } from '@playwright/test';

// Ô tìm khách hàng F4 trước đây chỉ bắt Escape: bàn phím không di chuyển được giữa các
// khách và cũng không chọn được. Nay mũi tên di chuyển (có cuộn theo) + Enter chọn.
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

/** Dòng có nằm trọn trong khung cuộn của dropdown không. */
function isFullyVisible(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => {
    const scroller = el.closest('div[id$="dropdown"]') as HTMLElement | null;
    if (!scroller) return false;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
}

/** Dòng có được đánh dấu đang chọn không (class thật, không phải hover:). */
function isActiveRow(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => el.classList.contains('bg-blue-50'));
}

test('bàn phím chọn được khách hàng trong ô F4 (mũi tên + Enter)', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');

  await input.click();
  // Gõ rộng để ra nhiều khách hơn
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });

  // Chọn dòng theo CẤU TRÚC (div con trực tiếp của dropdown) chứ không theo data-attr,
  // để test chạy được cả trên code cũ — nếu dùng attribute mới thì test chỉ bị skip và
  // không bắt được lỗi hồi quy. Loại dòng "Tạo khách hàng mới" (không phải khách hàng).
  const rows = dropdown.locator(':scope > div:not(#btn-quick-create-customer)');
  const count = await rows.count();
  const firstText = count > 0 ? (await rows.first().innerText()) || '' : '';
  test.skip(firstText.includes('Không tìm thấy'), 'không có khách hàng nào khớp từ khoá');
  test.skip(count < 2, 'cần ít nhất 2 khách hàng để kiểm tra di chuyển bằng bàn phím');

  // Dòng đầu tiên đang active
  await expect.poll(() => isActiveRow(rows.first())).toBe(true);

  // Mũi tên xuống -> dòng kế tiếp được highlight
  await input.press('ArrowDown');
  await page.waitForTimeout(150);
  await expect.poll(() => isActiveRow(rows.nth(1))).toBe(true);

  // Tới dòng cuối: dòng đó phải nằm trọn trong khung (có cuộn theo)
  for (let i = 0; i < count - 2; i += 1) {
    await input.press('ArrowDown');
    await page.waitForTimeout(100);
  }
  const last = rows.nth(count - 1);
  await expect.poll(() => isActiveRow(last)).toBe(true);
  expect(await isFullyVisible(last)).toBe(true);

  // Mũi tên lên -> quay về dòng đầu
  for (let i = 0; i < count - 1; i += 1) {
    await input.press('ArrowUp');
    await page.waitForTimeout(100);
  }
  await expect.poll(() => isActiveRow(rows.first())).toBe(true);
  expect(await isFullyVisible(rows.first())).toBe(true);

  // Enter chọn khách -> tên hiện trong ô F4, dropdown đóng
  const expectedName = (await rows.first().innerText()).split('\n')[0].trim();
  await input.press('Enter');
  await expect(dropdown).toHaveCount(0, { timeout: 10_000 });
  await expect(input).toHaveValue(expectedName);
  console.log('PICKED=' + expectedName);
});

test('Escape đóng dropdown khách như cũ', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');
  await input.click();
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });
  await input.press('Escape');
  await expect(dropdown).toHaveCount(0, { timeout: 10_000 });
});
