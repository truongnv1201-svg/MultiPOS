import { test, expect, type Page } from '@playwright/test';

// Ã” tÃ¬m khÃ¡ch hÃ ng F4 trÆ°á»›c Ä‘Ã¢y chá»‰ báº¯t Escape: bÃ n phÃ­m khÃ´ng di chuyá»ƒn Ä‘Æ°á»£c giá»¯a cÃ¡c
// khÃ¡ch vÃ  cÅ©ng khÃ´ng chá»n Ä‘Æ°á»£c. Nay mÅ©i tÃªn di chuyá»ƒn (cÃ³ cuá»™n theo) + Enter chá»n.
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

/** DÃ²ng cÃ³ náº±m trá»n trong khung cuá»™n cá»§a dropdown khÃ´ng. */
function isFullyVisible(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => {
    const scroller = el.closest('div[id$="dropdown"]') as HTMLElement | null;
    if (!scroller) return false;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
}

/** DÃ²ng cÃ³ Ä‘Æ°á»£c Ä‘Ã¡nh dáº¥u Ä‘ang chá»n khÃ´ng (class tháº­t, khÃ´ng pháº£i hover:). */
function isActiveRow(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => el.classList.contains('bg-blue-50'));
}

test('bÃ n phÃ­m chá»n Ä‘Æ°á»£c khÃ¡ch hÃ ng trong Ã´ F4 (mÅ©i tÃªn + Enter)', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');

  await input.click();
  // GÃµ rá»™ng Ä‘á»ƒ ra nhiá»u khÃ¡ch hÆ¡n
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });

  // Chá»n dÃ²ng theo Cáº¤U TRÃšC (div con trá»±c tiáº¿p cá»§a dropdown) chá»© khÃ´ng theo data-attr,
  // Ä‘á»ƒ test cháº¡y Ä‘Æ°á»£c cáº£ trÃªn code cÅ© â€” náº¿u dÃ¹ng attribute má»›i thÃ¬ test chá»‰ bá»‹ skip vÃ 
  // khÃ´ng báº¯t Ä‘Æ°á»£c lá»—i há»“i quy.
  const rows = dropdown.locator(':scope > div');
  const count = await rows.count();
  const firstText = count > 0 ? (await rows.first().innerText()) || '' : '';
  test.skip(firstText.includes('KhÃ´ng tÃ¬m tháº¥y'), 'khÃ´ng cÃ³ khÃ¡ch hÃ ng nÃ o khá»›p tá»« khoÃ¡');
  test.skip(count < 2, 'cáº§n Ã­t nháº¥t 2 khÃ¡ch hÃ ng Ä‘á»ƒ kiá»ƒm tra di chuyá»ƒn báº±ng bÃ n phÃ­m');

  // DÃ²ng Ä‘áº§u tiÃªn Ä‘ang active
  await expect.poll(() => isActiveRow(rows.first())).toBe(true);

  // MÅ©i tÃªn xuá»‘ng -> dÃ²ng káº¿ tiáº¿p Ä‘Æ°á»£c highlight
  await input.press('ArrowDown');
  await page.waitForTimeout(150);
  await expect.poll(() => isActiveRow(rows.nth(1))).toBe(true);

  // Tá»›i dÃ²ng cuá»‘i: dÃ²ng Ä‘Ã³ pháº£i náº±m trá»n trong khung (cÃ³ cuá»™n theo)
  for (let i = 0; i < count - 2; i += 1) {
    await input.press('ArrowDown');
    await page.waitForTimeout(100);
  }
  const last = rows.nth(count - 1);
  await expect.poll(() => isActiveRow(last)).toBe(true);
  expect(await isFullyVisible(last)).toBe(true);

  // MÅ©i tÃªn lÃªn -> quay vá» dÃ²ng Ä‘áº§u
  for (let i = 0; i < count - 1; i += 1) {
    await input.press('ArrowUp');
    await page.waitForTimeout(100);
  }
  await expect.poll(() => isActiveRow(rows.first())).toBe(true);
  expect(await isFullyVisible(rows.first())).toBe(true);

  // Enter chá»n khÃ¡ch -> tÃªn hiá»‡n trong Ã´ F4, dropdown Ä‘Ã³ng
  const expectedName = (await rows.first().innerText()).split('\n')[0].trim();
  await input.press('Enter');
  await expect(dropdown).toHaveCount(0, { timeout: 10_000 });
  await expect(input).toHaveValue(expectedName);
  console.log('PICKED=' + expectedName);
});

test('Escape Ä‘Ã³ng dropdown khÃ¡ch nhÆ° cÅ©', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');
  await input.click();
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });
  await input.press('Escape');
  await expect(dropdown).toHaveCount(0, { timeout: 10_000 });
});
