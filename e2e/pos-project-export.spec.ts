import { test, expect, type Page } from '@playwright/test';

// Luồng "Xuất CT" trong POS: bảng dòng vật tư, chọn công trình, nút commit bị chặn
// đúng lý do. KHÔNG bấm commit ở đây để không ghi dữ liệu thật vào DB dùng chung —
// phần ghi server được kiểm bằng `npm run test:live:project` (scripts/verify-project-materials.mjs).
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

async function addFirstProduct(page: Page, term: string) {
    const search = page.locator('#f1-search-input');
    await search.fill(term);
    await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 10_000 });
    await page.locator('#search-results-dropdown div[id^="search-item-"]').first().click();
    if (await page.locator('#dimension-modal-overlay').count()) {
        await page.locator('#btn-close-dimension-modal').click();
        await expect(page.locator('#dimension-modal-overlay')).toHaveCount(0, { timeout: 15_000 });
    }
    await page.waitForTimeout(900);
}

test.describe('POS: luồng xuất vật tư công trình', () => {
    test('có tab thứ 3, đổi bảng dòng và chặn commit khi chưa chọn công trình', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);

        // 1) 3 tab: Bán hàng / Nhập hàng / Xuất CT
        await expect(page.locator('button:has-text("Bán hàng")')).toHaveCount(1);
        await expect(page.locator('button:has-text("Nhập hàng")')).toHaveCount(1);
        await expect(page.locator('button:has-text("Xuất CT")')).toHaveCount(1);

        // 2) chuyển sang Xuất CT -> hiện khung dòng vật tư, ẩn giỏ bán
        await page.locator('button:has-text("Xuất CT")').click();
        await page.waitForTimeout(900);
        await expect(page.locator('#project-table-container')).toBeVisible();
        await expect(page.locator('#cart-table-container')).toHaveCount(0);
        await expect(page.locator('#import-table-container')).toHaveCount(0);
        // chưa có dòng -> khung trống mời gọi thêm
        await expect(page.locator('#project-table-container')).toContainText('Chưa có vật tư nào để xuất');

        // 3) thêm vật tư -> bảng có cột giá vốn + tồn còn lại (không phải đơn giá bán)
        await addFirstProduct(page, 'keo');
        const rows = page.locator('#project-table-container tbody tr');
        expect(await rows.count()).toBeGreaterThan(0);
        await expect(page.locator('#project-table-container th', { hasText: 'Giá vốn' })).toHaveCount(1);
        await expect(page.locator('#project-table-container th', { hasText: 'Tồn còn lại' })).toHaveCount(1);

        // nút commit bị chặn vì chưa chọn công trình
        await expect(page.locator('#pos-payment-panel')).toContainText('Phải chọn công trình trước khi xuất');
        expect(await page.locator('#btn-project-export-commit').isDisabled()).toBe(true);

        // 4) sửa SL -> thành tiền + tồn còn lại chạy theo
        const qtyInput = rows.first().locator('input').first();
        await qtyInput.fill('3');
        await page.waitForTimeout(600);
        await expect(qtyInput).toHaveValue('3');
        // 3 x 15.000 = 45.000 và tồn 252 - 3 = 249
        const detail = (await rows.first().innerText()).replace(/\s+/g, ' ');
        expect(detail).toContain('45.000 đ');
        expect(detail).toContain('249');
        await expect(page.locator('#pos-payment-panel')).toContainText('Tổng giá vốn xuất');
    });

    test('chọn công trình thì nút commit mở khoá', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await page.locator('button:has-text("Xuất CT")').click();
        await page.waitForTimeout(900);
        await addFirstProduct(page, 'keo');

        const sel = page.locator('#pos-payment-panel input[placeholder*="xuất vật tư"]');
        await sel.click();
        await page.waitForTimeout(1200);
        const opts = page.locator(
            '#pos-payment-panel [role="option"], #pos-payment-panel [id^="searchable-option"], #pos-payment-panel ul li'
        );
        if ((await opts.count()) === 0) {
            test.skip(true, 'DB chưa có công trình nào để chọn');
        }
        await opts.first().click();
        await page.waitForTimeout(700);
        // KHÔNG bấm commit (tránh ghi dữ liệu thật) — chỉ kiểm nút đã mở khoá
        expect(await page.locator('#btn-project-export-commit').isDisabled()).toBe(false);
    });
});
