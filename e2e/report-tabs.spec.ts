import { test, expect, type Page } from '@playwright/test';

// Nhãn tab báo cáo KHÔNG mang số đếm — số nằm ở dòng tổng hợp dưới tiêu đề bảng
// (chuẩn các bảng chính). Khóa cả 4 tab + nút gạt Phải thu/Phải trả.
async function loginAdmin(page: Page) {
    await page.goto('/');
    await expect(page.locator('#login-modal-overlay')).toBeVisible();
    await page.fill('#login-id-input', process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local');
    await page.fill('#login-password-input', process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123');
    await page.click('#btn-login-submit');
    await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(6000);
}

test.describe('Báo cáo: nhãn tab không mang số đếm', () => {
    test('4 tab + nút gạt công nợ đều gọn, số nằm ở dòng tổng hợp', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await page.keyboard.press('Alt+m');
        await expect(page.locator('#flyout-overlay')).toBeVisible({ timeout: 10_000 });
        await page.locator('#menu-item-reports').click();
        await expect(page.locator('#reports-view')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(2500);

        // Nhãn tab gọn, không ngoặc số
        for (const label of ['Tổng quan', 'VAT đầu ra', 'Mặt hàng', 'Công nợ']) {
            const tab = page.locator('#reports-view button', { hasText: new RegExp(`^${label}$`) });
            await expect(tab, `tab "${label}" phải gọn không số`).toHaveCount(1);
        }
        // Không còn nhãn kiểu "VAT đầu ra (1)"
        const tabBar = await page.locator('#reports-view').innerText();
        expect(tabBar).not.toMatch(/VAT đầu ra \(\d+\)/);
        expect(tabBar).not.toMatch(/Mặt hàng \(\d+\)/);
        expect(tabBar).not.toMatch(/Công nợ \(\d+\)/);

        // Tab VAT: số tháng nằm ở dòng tổng hợp
        await page.locator('#reports-view button', { hasText: /^VAT đầu ra$/ }).click();
        await page.waitForTimeout(800);
        await expect(page.locator('#reports-view')).toContainText(/Tìm thấy\s+\d+\s+tháng/);

        // Tab Mặt hàng: số mặt hàng nằm ở dòng tổng hợp
        await page.locator('#reports-view button', { hasText: /^Mặt hàng$/ }).click();
        await page.waitForTimeout(800);
        await expect(page.locator('#reports-view')).toContainText(/Tìm thấy\s+\d+\s+mặt hàng/);

        // Tab Công nợ: nút gạt gọn + số nằm ở dòng tổng hợp
        await page.locator('#reports-view button', { hasText: /^Công nợ$/ }).click();
        await page.waitForTimeout(800);
        await expect(page.locator('#reports-view button', { hasText: /^Phải thu KH$/ })).toHaveCount(1);
        await expect(page.locator('#reports-view button', { hasText: /^Phải trả NCC$/ })).toHaveCount(1);
        await expect(page.locator('#reports-view')).toContainText(/Tìm thấy\s+\d+\s+(khách đang nợ|NCC đang nợ)/);
    });
});
