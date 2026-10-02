import { test, expect, type Page } from '@playwright/test';

// Regression: điều hướng bằng mũi tên trong dropdown tìm hàng không cuộn theo dòng đang
// chọn, nên khi đi tới các dòng dưới cùng thì người dùng không nhìn thấy dòng đó.
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

/** Dòng có nằm trọn trong khung cuộn của dropdown không. */
function isFullyVisible(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => {
    const scroller = el.closest('div.overflow-y-auto') as HTMLElement | null;
    if (!scroller) return false;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
}

test('mũi tên xuống cuối danh sách thì dòng đang chọn phải hiện trong khung', async ({ page }) => {
  await login(page);
  const dropdown = page.locator('#search-results-dropdown');
  const search = page.locator('#f1-search-input');

  await search.click();

  // Tìm từ khoá cho ra đủ nhiều dòng để dropdown vượt quá chiều cao khung
  let items = dropdown.locator('div[id^="search-item-"]');
  let count = 0;
  for (const term of ['n', 'e', 'i', 'a', 'o', 'u']) {
    await search.fill(term);
    const visible = await dropdown.isVisible().catch(() => false);
    if (!visible) continue;
    const n = await items.count();
    if (n > count) count = n;
    if (count >= 5) break;
  }
  expect(count, 'cần ít nhất 5 dòng để dropdown phải cuộn').toBeGreaterThanOrEqual(5);
  // Lấy lại đúng truy vấn đang cho nhiều kết quả nhất
  for (const term of ['n', 'e', 'i', 'a', 'o', 'u']) {
    await search.fill(term);
    if (await dropdown.isVisible().catch(() => false)) {
      if ((await items.count()) === count) break;
    }
  }

  // Đi xuống từng dòng một tới dòng cuối
  for (let i = 0; i < count - 1; i += 1) {
    await search.press('ArrowDown');
    await page.waitForTimeout(120);
  }

  const last = items.nth(count - 1);
  // Dòng cuối phải được highlight (đúng là dòng đang chọn)
  await expect(last).toHaveClass(/bg-blue-50/);
  // ...và phải nằm trọn trong khung nhìn được
  expect(await isFullyVisible(last)).toBe(true);

  // Đi ngược lên cũng phải cuộn (dòng đầu tiên)
  for (let i = 0; i < count - 1; i += 1) {
    await search.press('ArrowUp');
    await page.waitForTimeout(120);
  }
  const first = items.first();
  await expect(first).toHaveClass(/bg-blue-50/);
  expect(await isFullyVisible(first)).toBe(true);
});
