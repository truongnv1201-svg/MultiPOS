import { test, expect, type Page } from '@playwright/test';

const CASHIER_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const CASHIER_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';

async function login(page: Page, id: string, pw: string) {
    await page.goto('/');
    await expect(page.locator('#login-modal-overlay')).toBeVisible();
    await page.fill('#login-id-input', id);
    await page.fill('#login-password-input', pw);
    await page.click('#btn-login-submit');
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
    await expect(page.locator('#cart-table-container tbody tr').first()).toBeVisible({
        timeout: 10_000,
    });
}

test.describe('POS: quyền sửa đơn giá (migration 0059)', () => {
    test('thu ngân KHÔNG sửa được đơn giá', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await login(page, CASHIER_ID, CASHIER_PW);
        await addFirstProduct(page, 'keo');

        // Không có nút/ô sửa giá cho thu ngân
        await expect(page.locator('#cart-table-container').getByLabel(/^Đơn giá /)).toHaveCount(0);
        // Vẫn hiện giá (dạng text tĩnh) để thu ngân đối chiếu được
        const priceCell = page.locator('#cart-table-container tbody tr').first().locator('td').nth(3);
        await expect(priceCell).toContainText('đ');
        await expect(priceCell.locator('span[title]')).toHaveAttribute(
            'title',
            /Chỉ Quản lý\/Admin/
        );
    });

    test('Quản lý/Admin sửa được giá, thành tiền chạy theo', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await login(page, ADMIN_ID, ADMIN_PW);
        await addFirstProduct(page, 'keo');

        const row = page.locator('#cart-table-container tbody tr').first();
        const priceBtn = row.getByLabel(/^Đơn giá /);
        await expect(priceBtn).toBeVisible();

        const subtotalCell = row.locator('td').nth(6);
        const subtotalBefore = await subtotalCell.innerText();
        const priceBefore = await priceBtn.innerText();
        const original = priceBefore.replace(/[^\d]/g, '');

        // Bấm giá -> ô nhập mở ra, gõ giá mới
        await priceBtn.click();
        const input = row.getByLabel(/^Đơn giá /);
        await expect(input).toBeVisible();
        await input.fill('15000');
        await input.press('Enter');

        // Thành tiền dòng chạy theo giá mới (qty 1 -> 15.000)
        await expect(subtotalCell).not.toHaveText(subtotalBefore);
        await expect(subtotalCell).toContainText('15.000');

        // Ô đóng lại thành nút, có đánh dấu "đã sửa"
        await expect(priceBtn).toBeVisible();
        await expect(priceBtn).toHaveAttribute('title', /Đã sửa đơn giá/);
        await expect(priceBtn).toContainText('15.000');

        // Gõ lại đúng giá danh mục -> bỏ dấu "đã sửa" (server sẽ lấy giá catalog)
        await priceBtn.click();
        await row.getByLabel(/^Đơn giá /).fill(original);
        await row.getByLabel(/^Đơn giá /).press('Enter');
        await expect(priceBtn).toHaveAttribute('title', /Sửa đơn giá/);
        await expect(subtotalCell).toHaveText(subtotalBefore);
    });
});
