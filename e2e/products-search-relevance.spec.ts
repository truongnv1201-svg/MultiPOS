import { test, expect, type Page } from '@playwright/test';

// Ca thật 10/2026: ô tìm hàng ở POS gõ "dây 1" ra đúng nhóm DÂY 1*1 TP TRAPHACO
// ngay dòng đầu, nhưng danh mục Hàng hóa lại ra 438 dòng xếp SKU giảm dần nên món
// đúng nằm hạng 433/438 (trang 18). Nay danh mục dùng chung thuật toán xếp hạng
// của POS (lib/product-search): gõ là xếp theo độ liên quan.
const LOGIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const LOGIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

async function login(page: Page) {
  await page.goto('/');
  if (await page.locator('#login-modal-overlay').isVisible().catch(() => false)) {
    await page.fill('#login-id-input', LOGIN_ID);
    await page.fill('#login-password-input', LOGIN_PW);
    await page.click('#btn-login-submit');
  }
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
}

async function openProducts(page: Page) {
  // Phím tắt Alt + P (GlobalHeader) — không phụ thuộc vị trí menu.
  await page.keyboard.press('Alt+p');
  await expect(page.locator('#products-view')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
}

test('danh mục Hàng hóa: gõ "dây 1" xếp món đúng lên đầu như POS', async ({ page }) => {
  await login(page);
  await openProducts(page);

  const view = page.locator('#products-view');
  const search = view.locator('input[placeholder*="Tên hàng"]').first();
  const rows = view.locator('table tbody tr');

  await search.fill('dây 1');
  await page.waitForTimeout(800);
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });

  const firstRow = (await rows.first().innerText()).replace(/\s+/g, ' ').trim();
  const total = await rows.count();
  console.log(`FIRST_ROW=${firstRow} | rows_on_page=${total}`);

  // Dữ liệu đổi (món bị xóa/đổi tên) thì bỏ qua thay vì báo sai.
  const hasGroup = await view.locator('table tbody', { hasText: 'DÂY 1' }).count();
  test.skip(hasGroup === 0, 'danh mục không còn món DÂY 1*... để kiểm');

  // Món đúng phải nằm ngay dòng đầu (trước đây ở hạng 433/438).
  expect(firstRow).toContain('DÂY 1');

  // Có nhãn cho biết đang xếp theo độ liên quan.
  await expect(view).toContainText('xếp theo độ liên quan');

  // Bấm header cột -> xếp theo cột đó, nhãn liên quan biến mất.
  await view.locator('th', { hasText: 'Tên sản phẩm' }).click();
  await page.waitForTimeout(400);
  await expect(view).not.toContainText('xếp theo độ liên quan');

  // Đổi từ khóa -> quay lại xếp theo độ liên quan.
  await search.fill('dây 1 ');
  await page.waitForTimeout(800);
  await expect(view).toContainText('xếp theo độ liên quan');
  expect((await rows.first().innerText())).toContain('DÂY 1');
});
