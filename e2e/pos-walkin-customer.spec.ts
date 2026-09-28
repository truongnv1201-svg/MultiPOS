import { test, expect, type Page } from '@playwright/test';

// Lỗi: ô khách hàng F4 hiện value = customerSearch || customer_name, nên khi xóa tới
// ký tự cuối, nhãn "Khách Lẻ Mua Tại Quầy" tự nhảy lại — không bao giờ xóa trống được,
// phải căn ke số lần bấm Delete.
// Nay: (1) đang sửa thì ô hiện đúng chuỗi gõ kể cả khi rỗng, (2) khách lẻ là một MỤC
// chọn được trong danh sách gợi ý (mặc định của đơn mới), không phải bản ghi DB.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';
const WALK_IN = 'Khách Lẻ Mua Tại Quầy';

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

test('xóa hết chữ trong ô khách hàng thì ô trống, không tự nhảy lại nhãn khách lẻ', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');

  // Đơn mới: mặc định hiện nhãn khách lẻ
  await expect(input).toHaveValue(WALK_IN);

  // Bấm vào ô (text được bôi đen) rồi xóa hết
  await input.click();
  await input.press('Delete');
  await page.waitForTimeout(400);
  console.log('SAU_1_LAN_DELETE=' + JSON.stringify(await input.inputValue()));
  await expect(input).toHaveValue('');

  // Bấm Delete thêm lần nữa: trước đây nhãn khách lẻ nhảy lại, giờ vẫn trống
  await input.press('Delete');
  await page.waitForTimeout(300);
  await expect(input).toHaveValue('');

  // Gõ tiếp không bị dính chữ của nhãn cũ (lỗi "ký tự bị dính" đã sửa trước đây)
  await input.type('Anh', { delay: 60 });
  await expect(input).toHaveValue('Anh');
});

test('khách lẻ là một mục chọn được trong danh sách gợi ý', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');

  // Mở danh sách: mục đầu tiên phải là khách lẻ
  await input.click();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  const firstRow = dropdown.locator(':scope > div:not(#btn-quick-create-customer)').first();
  await expect(firstRow).toContainText(WALK_IN);
  await expect(firstRow).toContainText('Mặc định');

  // Chọn một khách thật, rồi chọn lại khách lẻ -> phải quay về nhãn khách lẻ
  await input.fill('a');
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  const rows = dropdown.locator(':scope > div:not(#btn-quick-create-customer)');
  const count = await rows.count();
  test.skip(count < 3, 'cần ít nhất 2 khách thật + 1 khách lẻ');
  const realName = (await rows.nth(1).innerText()).split('\n')[0].trim();
  await rows.nth(1).click();
  await expect(input).toHaveValue(realName);

  // Mở lại danh sách và chọn mục khách lẻ ở đầu
  await input.click();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  await dropdown.locator(':scope > div:not(#btn-quick-create-customer)').first().click();
  await expect(input).toHaveValue(WALK_IN);
  console.log('WALK_IN_SELECTED_AGAIN=ok');
});

test('gõ "lẻ" vẫn tìm ra mục khách lẻ', async ({ page }) => {
  await login(page);
  const input = page.locator('#f4-customer-input');
  const dropdown = page.locator('#customer-search-dropdown');
  await input.click();
  await input.fill('lẻ');
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  const rows = dropdown.locator(':scope > div:not(#btn-quick-create-customer)');
  await expect(rows.first()).toContainText(WALK_IN);
});
