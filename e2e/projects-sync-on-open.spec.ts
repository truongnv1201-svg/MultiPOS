import { test, expect, type Page } from '@playwright/test';

// Dự án trước đây KHÔNG tự đồng bộ: bảng projects không nằm trong publication realtime
// (migration 0049 chỉ có 10 bảng nghiệp vụ), không có trong TABLE_REFRESH, và syncProjects
// chỉ chạy lúc đăng nhập / vào lại mạng. ProjectsView cũng không gọi lại khi mở.
// Hệ quả thật: tạo/sửa dự án ở máy khác thì máy này không thấy tới khi tải lại trang, và
// người dùng không có tín hiệu nào cho biết dữ liệu đang cũ.
//
// Test: máy A đăng nhập rồi đứng ở POS (KHÔNG mở màn Dự án), máy B tạo dự án, rồi A mở màn
// Dự án phải thấy ngay mà không cần tải lại trang.
//
// Dọn: UI không có nút xoá dự án, nên dự án test được dọn bằng SQL sau khi chạy:
//   delete from public.projects where name like 'TEST-DONGBO%';
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', ADMIN_ID);
  await page.fill('#login-password-input', ADMIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

test('mở màn Dự án phải thấy dự án vừa tạo ở máy khác, không cần tải lại trang', async ({ page, browser }) => {
  test.slow();

  // Máy A: đăng nhập, cố ý KHÔNG mở màn Dự án
  await login(page);
  await expect(page.locator('#network-status-toggle')).toContainText('Trực tiếp', { timeout: 30_000 });
  await page.waitForTimeout(10_000);

  // Máy B: tạo dự án mới
  const name = 'TEST-DONGBO ' + Date.now().toString().slice(-6);
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await login(pageB);
  await pageB.keyboard.press('Alt+j');
  await expect(pageB.locator('#projects-view')).toBeVisible({ timeout: 20_000 });
  await pageB.click('#btn-add-project');
  await expect(pageB.locator('#new-project-name-input')).toBeVisible({ timeout: 15_000 });
  await pageB.fill('#new-project-name-input', name);
  // addProject cập nhật state cục bộ TRƯỚC rồi mới POST lên server, nên phải chờ POST
  // xong thì máy A mới chắc chắn thấy. Không yêu cầu status 2xx: khi mã CT trùng, app
  // fallback sang PATCH bản server (xem pushProjectToServer) nên POST trả 409.
  const pushed = pageB.waitForResponse(
    (r) => r.url().includes('/rest/v1/projects') && r.request().method() === 'POST',
    { timeout: 30_000 }
  );
  await pageB.getByRole('button', { name: /^Tạo dự án$/ }).click();
  await pushed;
  await expect(pageB.locator('#projects-view')).toContainText(name, { timeout: 30_000 });
  console.log('CREATED=' + name);
  // Máy A mở màn Dự án lần đầu tiên: phải thấy dự án vừa tạo
  const t0 = Date.now();
  await page.keyboard.press('Alt+j');
  await expect(page.locator('#projects-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#projects-view')).toContainText(name, { timeout: 25_000 });
  console.log('PROJECTS_FRESH_MS=' + (Date.now() - t0));
  await ctxB.close();
});
