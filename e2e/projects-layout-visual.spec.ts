import { test, expect, type Page } from '@playwright/test';

// Chụp màn Dự án để soi bố cục 3 cột sau khi thiết kế lại. Test này chỉ chụp ảnh +
// kiểm tra các khối bắt buộc có mặt, không khẳng định số liệu.

async function loginAdmin(page: Page) {
  await page.goto('/');
  if (await page.locator('#login-modal-overlay').isVisible().catch(() => false)) {
    await page.fill('#login-id-input', process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local');
    await page.fill('#login-password-input', process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123');
    await page.click('#btn-login-submit');
  }
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
}

test('màn Dự án: 3 cột đúng bố cục', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 950 });
  await loginAdmin(page);
  await page.keyboard.press('Alt+j');
  await expect(page.locator('#projects-view')).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(2500);

  // Cột trái: ô tìm kiếm + danh sách
  await expect(page.locator('#project-list-search')).toBeVisible();
  await expect(page.locator('text=TÌM KIẾM DỰ ÁN')).toBeVisible();
  await expect(page.locator('text=DANH SÁCH DỰ ÁN')).toBeVisible();

  // Cột giữa: thông tin + 4 ô số + 3 tab giai đoạn + 2 bảng chi phí
  await expect(page.locator('text=THÔNG TIN DỰ ÁN')).toBeVisible();
  for (const label of ['Hợp đồng quyết toán', 'Dự toán dính thước', 'Đã thu (cọc/đợt)', 'Còn phải thu']) {
    await expect(page.locator(`text=${label}`).first()).toBeVisible();
  }
  for (const tab of ['DỰ TOÁN', 'THI CÔNG', 'QUYẾT TOÁN']) {
    await expect(page.locator(`button:has-text("${tab}")`)).toBeVisible();
  }
  await expect(page.locator('h4:has-text("CHI PHÍ NHÂN CÔNG")')).toBeVisible();
  await expect(page.locator('h4:has-text("CHI PHÍ VẬT TƯ")')).toBeVisible();
  // Nhân công phải đứng TRƯỚC vật tư sau khi áp order-1 / order-2
  const labor = await page.locator('h4:has-text("CHI PHÍ NHÂN CÔNG")').boundingBox();
  const mat = await page.locator('h4:has-text("CHI PHÍ VẬT TƯ")').boundingBox();
  expect(labor, 'phải tìm thấy card nhân công').not.toBeNull();
  expect(mat, 'phải tìm thấy card vật tư').not.toBeNull();
  expect(labor!.y, 'nhân công phải nằm trên vật tư').toBeLessThan(mat!.y);

  // Cột phải: P&L + tiền độ + cơ cấu chi phí
  await expect(page.locator('text=BÁO CÁO P&L HẠCH TOÁN LÃI')).toBeVisible();
  await expect(page.locator('text=TIỀN ĐỘ THU TIỀN')).toBeVisible();
  await expect(page.locator('text=CƠ CẤU CHI PHÍ DỰ ÁN')).toBeVisible();
  await expect(page.locator('#btn-project-collect-deposit')).toBeVisible();
  await expect(page.locator('text=Lợi nhuận gộp:')).toBeVisible();

  // Tìm kiếm lọc được danh sách
  const countText = await page.locator('#project-list-search').locator('xpath=../..').innerText();
  console.log('HEADER COT TRAI:', countText.replace(/\s+/g, ' '));
  const firstCard = page.locator('#projects-view aside button').nth(3);
  const name = (await firstCard.innerText()).split('\n')[1] || '';
  await page.locator('#project-list-search').fill('zzzz-khong-co');
  await page.waitForTimeout(600);
  await expect(page.locator('text=Không có dự án nào khớp từ khoá')).toBeVisible();
  await page.locator('#project-list-search').fill('');
  await page.waitForTimeout(600);

  await page.screenshot({ path: 'test-results/projects-redesign.png', fullPage: false });
});
