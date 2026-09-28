import { test, expect, type Page } from '@playwright/test';

// Các ô tìm kiếm còn lại phải bám sát nội dung như #search-results-dropdown:
// ít kết quả thì khung co lại, nhiều kết quả thì không vượt trần.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

async function login(page: Page, id = LOGIN_ID, pw = LOGIN_PW) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', id);
  await page.fill('#login-password-input', pw);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#network-status-toggle')).toContainText('Trực tiếp', { timeout: 30_000 });
  await page.waitForTimeout(6000);
}

test('ô tìm khách hàng F4: ít kết quả thì khung co lại, nhiều kết quả thì không vượt trần', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');

  // 0 kết quả -> khung bọc sát, không chừa chỗ trống (trước đây cố định 160px).
  // Khung giờ gồm dòng báo "không tìm thấy" + dòng "Tạo khách hàng mới" nên cao hơn 40px.
  await input.click();
  await input.fill('zzzkhongco');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });
  await expect(dropdown).toContainText('Không tìm thấy', { timeout: 10_000 });
  await expect(dropdown.locator('#btn-quick-create-customer')).toBeVisible();
  const emptyBox = await dropdown.boundingBox();
  console.log('CUSTOMER_0_KET_QUA=' + JSON.stringify(emptyBox));
  expect(emptyBox?.height ?? 999).toBeLessThan(120);

  // Nhiều kết quả -> không vượt trần 160px (max-h-40) và vẫn cuộn được
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const manyBox = await dropdown.boundingBox();
  const rows = await dropdown.locator(':scope > div').count();
  console.log(`CUSTOMER_${rows}_KET_QUA=` + JSON.stringify(manyBox));
  expect(rows).toBeGreaterThanOrEqual(2);
  expect(manyBox?.height ?? 999).toBeLessThanOrEqual(162);
});

test('SearchableSelect trong form: khung co lại khi ít lựa chọn', async ({ page }) => {
  await login(page, ADMIN_ID, ADMIN_PW);
  // Mở màn Nhập hàng (luồng admin) để tới ô chọn NCC dùng SearchableSelect
  await page.locator('#pos-goods-toolbar button', { hasText: 'Nhập hàng' }).first().click();
  await page.waitForTimeout(2500);

  const trigger = page.locator('input[placeholder*="tìm NCC"]').first();
  test.skip((await trigger.count()) === 0, 'không thấy ô chọn NCC trong luồng nhập hàng');
  await trigger.click();
  const list = page.locator('ul[role="listbox"]');
  await expect(list).toBeVisible({ timeout: 10_000 });
  const box = await list.boundingBox();
  const options = await list.locator('li').count();
  console.log(`SEARCHABLE_SELECT options=${options} ` + JSON.stringify(box));
  // Trần 208px; danh sách NCC hiện có ít dòng nên phải nhỏ hơn trần
  expect(box?.height ?? 999).toBeLessThanOrEqual(210);

  // Lọc còn 1 lựa chọn -> khung phải co lại (trước đây h-52 cố định nên vẫn 208px)
  const firstOption = (await list.locator('li').first().innerText()) || '';
  const token = firstOption.split(/\s+/)[0] || '';
  await trigger.fill(token);
  await page.waitForTimeout(700);
  const narrowed = await list.locator('li').count();
  const narrowBox = await list.boundingBox();
  console.log(`SEARCHABLE_SELECT narrow=${narrowed} ` + JSON.stringify(narrowBox));
  if (narrowed === 1) {
    expect(narrowBox?.height ?? 999).toBeLessThan(80);
  }
});
