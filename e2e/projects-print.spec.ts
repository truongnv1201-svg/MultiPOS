import { test, expect, type Page } from '@playwright/test';

// Hồi quy: nút In ở trang Dự án từng chết hoàn toàn trên desktop —
// printDocumentViaIframe dựng iframe nhưng QUÊN gọi print(), bấm In không hiện gì
// mà cũng không báo lỗi. Test này khóa lại đường dây:
// bấm In -> có đúng 1 iframe in ẩn -> tài liệu trong iframe chứa mã công trình + bảng.
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

test.describe('Dự án: nút In mở tài liệu in', () => {
    test('bấm In sinh iframe in chứa quyết toán công trình đang chọn', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
        await loginAdmin(page);
        await page.keyboard.press('Alt+j');
        await expect(page.locator('#projects-view')).toBeVisible({ timeout: 25_000 });
        await page.waitForTimeout(2000);

        // Chọn công trình đầu danh sách cột trái để chắc chắn có currentProject (In cần nó)
        const firstCard = page.locator('#projects-view aside').first().locator('button', { hasText: /CT-/ }).first();
        await firstCard.click();
        await page.waitForTimeout(800);
        const projectCode = ((await firstCard.innerText()).match(/CT-[\d-]+/) || [''])[0];
        expect(projectCode, 'phải đọc được mã công trình đang chọn').not.toBe('');

        // Bấm In trong cụm TableTools của header
        await page.locator('#projects-view button[title="In bảng đang xem"]').click();

        // Iframe in phải xuất hiện ngay (doc.write đồng bộ) và chứa mã CT + bảng
        const printDoc = await page.evaluate(() => {
            const frames = Array.from(document.querySelectorAll('iframe[aria-hidden="true"]'));
            if (frames.length !== 1) return { count: frames.length, text: '' };
            const doc = (frames[0] as HTMLIFrameElement).contentDocument;
            return { count: 1, text: (doc?.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500) };
        });
        expect(printDoc.count, 'bấm In phải sinh đúng 1 iframe in').toBe(1);
        expect(printDoc.text, 'tài liệu in phải chứa mã công trình').toContain(projectCode);
        expect(printDoc.text.toLowerCase()).toContain('quyết toán');
        expect(errors, 'không được có lỗi JS khi in').toEqual([]);
    });
});
