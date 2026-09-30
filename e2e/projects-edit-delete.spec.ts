import { test, expect, type Page } from '@playwright/test';

// 0066 — Sửa thông tin + xoá dự án tạo nhầm.
//
// Chạy trên DB dùng chung nhưng TỰ DỌN: tạo dự án TEST-SUAXOA rồi xoá ngay trong test.
// Nếu test fail giữa chừng, tiền tố TEST-SUAXOA giúp nhận ra để dọn tay.
// Phần ghi server của xoá (hoàn kho + giữ audit) được kiểm riêng bằng script live
// `npm run test:live:delete-project` (scripts/verify-delete-project.mjs).

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

test.describe('Dự án: sửa thông tin + xoá tạo nhầm', () => {
    test('tạo sai -> sửa tên/địa chỉ -> xoá, danh sách sạch', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await page.keyboard.press('Alt+j');
        await expect(page.locator('#projects-view')).toBeVisible({ timeout: 25_000 });
        await page.waitForTimeout(1500);

        // 1) Tạo dự án cố tình sai thông tin
        const badName = 'TEST-SUAXOA-SAI ' + Date.now().toString().slice(-6);
        await page.click('#btn-add-project');
        await expect(page.locator('#new-project-name-input')).toBeVisible({ timeout: 15_000 });
        await page.fill('#new-project-name-input', badName);
        await page.getByRole('button', { name: /^Tạo dự án$/ }).click();
        await expect(page.locator('#projects-view')).toContainText(badName, { timeout: 30_000 });

        // chọn đúng card vừa tạo (bấm vào tên để chắc chắn selectedProject là nó)
        await page.locator('#projects-view aside button', { hasText: badName }).first().click();
        await page.waitForTimeout(800);

        // 2) Sửa tên + địa chỉ
        const goodName = badName.replace('SAI', 'SUA');
        await page.click('#btn-edit-project-info');
        const editModal = page.locator('[role="dialog"][aria-label="Sửa thông tin công trình"]');
        await expect(editModal).toBeVisible();
        // modal seed sẵn giá trị cũ
        await expect(page.locator('#edit-project-name-input')).toHaveValue(badName);
        await page.locator('#edit-project-name-input').fill(goodName);
        await editModal.locator('input[placeholder="Địa chỉ thi công"]').fill('123 Đường Test, Quận 1');
        await page.click('#btn-save-project-info');
        await expect(page.locator('#projects-view')).toContainText(goodName, { timeout: 15_000 });
        await expect(page.locator('#projects-view')).toContainText('123 Đường Test, Quận 1');

        // 3) Xoá: hộp xác nhận phải liệt kê hậu quả (hoàn kho + giữ tiền)
        await page.click('#btn-delete-project');
        const confirm = page.locator('[role="alertdialog"][aria-label="Xoá dự án"]');
        await expect(confirm).toBeVisible({ timeout: 10_000 });
        await expect(confirm).toContainText('HOÀN VỀ KHO');
        // Dự án test chưa thu đồng nào -> dialog hiện nhánh "sổ quỹ không đổi"
        // (nhánh "GIỮ NGUYÊN trong sổ quỹ" chỉ hiện khi đã thu tiền)
        await expect(confirm).toContainText('sổ quỹ không đổi');
        await expect(confirm).toContainText('Không thể hoàn tác');
        await page.getByRole('button', { name: 'Xoá vĩnh viễn' }).click();

        // 4) Danh sách không còn dự án đó (server xoá thật + local gỡ)
        await expect(page.locator('#projects-view')).not.toContainText(goodName, { timeout: 20_000 });
        await expect(page.locator('#projects-view')).not.toContainText(badName, { timeout: 20_000 });
    });
});
