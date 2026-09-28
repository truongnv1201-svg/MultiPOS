import { test, expect, type Page, type Locator } from '@playwright/test';

// Nút +/- trong giỏ: (1) màu phải giống nút "+" khách hàng để dễ nhìn, (2) bước nhảy theo
// giá trị đang có: ô nguyên thì 1 -> 2 -> 3, ô số lẻ thì 1,1 -> 1,2.
async function login(page: Page) {
    await page.goto('/');
    await expect(page.locator('#login-modal-overlay')).toBeVisible();
    await page.fill('#login-id-input', process.env.E2E_LOGIN_ID || 'cashier@multipos.local');
    await page.fill('#login-password-input', process.env.E2E_LOGIN_PASSWORD || 'Cashier@123');
    await page.click('#btn-login-submit');
    await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(6000);
}

type Colors = { bg: string; color: string; border: string };
const colors = (loc: Locator) =>
    loc.evaluate((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor };
    });

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

test.describe('Nút +/- giỏ: độ tương phản + bước nhảy', () => {
    test('màu nút +/- giống hệt nút + khách hàng', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page);
        await addFirstProduct(page, 'ổ cắm');

        const row = page.locator('#cart-table-container tbody tr').first();
        const custPlus = await colors(page.locator('#btn-quick-customer-modal'));
        const minus = await colors(row.locator('[title^="Giảm"]'));
        const plus = await colors(row.locator('[title^="Tăng"]'));

        expect(minus).toEqual(custPlus);
        expect(plus).toEqual(custPlus);
    });

    test('ô nguyên thì + nhảy 1 -> 2 -> 3, ô số lẻ thì + nhảy 0,1', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page);
        await addFirstProduct(page, 'ổ cắm');

        const row = page.locator('#cart-table-container tbody tr').first();
        const qty = row.locator('input');
        const bump = row.locator('[title^="Tăng"]');
        const read = async () => (await qty.inputValue()).replace(',', '.');

        // Mặc định bắt đầu ở 1 (nguyên) -> mỗi lần + đúng 1 đơn vị
        expect(await read()).toBe('1');
        await expect(bump).toHaveAttribute('title', 'Tăng 1');
        const seen: string[] = [];
        for (let i = 0; i < 3; i++) {
            await bump.click();
            await page.waitForTimeout(250);
            seen.push(await read());
        }
        expect(seen).toEqual(['2', '3', '4']);

        // Gõ số lẻ -> bước chuyển sang 0,1
        await qty.click();
        await qty.fill('1,1');
        await qty.press('Enter');
        await page.waitForTimeout(350);
        expect(await read()).toBe('1.1');
        await expect(bump).toHaveAttribute('title', 'Tăng 0.1');

        await bump.click();
        await page.waitForTimeout(300);
        expect(await read()).toBe('1.2');

        // Thành tiền chạy theo số lượng
        await expect(row.locator('td').nth(6)).toContainText('48.000');
    });
});
