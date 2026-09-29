import { test, expect, type Page } from '@playwright/test';

const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function login(page: Page) {
    await page.goto('/');
    await expect(page.locator('#login-modal-overlay')).toBeVisible();
    await page.fill('#login-id-input', LOGIN_ID);
    await page.fill('#login-password-input', LOGIN_PW);
    await page.click('#btn-login-submit');
    await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(6000);
}

/** Them 1 hang vao gio; hang dien tich se mo hop F3 nhap khich thuoc. */
async function addProduct(page: Page, term: string) {
    const search = page.locator('#f1-search-input');
    await search.fill(term);
    await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 10_000 });
    await page.locator('#search-results-dropdown div[id^="search-item-"]').first().click();
    if (await page.locator('#dimension-modal-overlay').count()) {
        await page.locator('#dimension-modal-overlay [data-dim-col="length"]').first().fill('2');
        await page.locator('#dimension-modal-overlay [data-dim-col="width"]').first().fill('1');
        await page.locator('#dimension-modal-overlay [data-dim-col="quantity"]').first().fill('2');
        await page.locator('#btn-confirm-dimension-modal').click();
        await expect(page.locator('#dimension-modal-overlay')).toHaveCount(0, { timeout: 15_000 });
    }
    await page.waitForTimeout(1000);
}

type Colors = { bg: string; color: string; border: string; height: string; radius: string };
const box = (loc: ReturnType<Page['locator']>) =>
    loc.evaluate((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        return {
            bg: cs.backgroundColor,
            color: cs.color,
            border: cs.borderColor,
            height: cs.height,
            radius: cs.borderTopLeftRadius,
        } as Colors;
    });

test.describe('Gio POS: cot don vi tinh + o sua duoc', () => {
    test('desktop: cot DVT dung chuan va o so luong dung style chung', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1440, height: 900 });
        await login(page);

        await addProduct(page, 'keo');
        await addProduct(page, 'kính');

        // 1) Co cot don vi tinh
        await expect(page.locator('#cart-table-container th', { hasText: 'ĐVT' })).toHaveCount(1);

        const rows = page.locator('#cart-table-container tbody tr');
        expect(await rows.count()).toBeGreaterThanOrEqual(2);

        // 2) Hang dien tich: don vi o cot DVT la m2 (khong con ghep sau so luong)
        const areaRow = rows.filter({ hasText: 'tấm' }).first();
        expect(await areaRow.count()).toBeGreaterThan(0);
        expect((await areaRow.locator('td').nth(2).innerText()).trim()).toBe('m²');
        expect(await areaRow.locator('td').nth(4).innerText()).not.toContain('m²');

        // 3) Hang thuong: don vi lay tu danh muc, khong rong
        const normalRow = rows.filter({ has: page.locator('input[aria-label^="Số lượng"]') }).first();
        expect(await normalRow.count()).toBeGreaterThan(0);
        const normalUnit = (await normalRow.locator('td').nth(2).innerText()).trim();
        expect(normalUnit.length).toBeGreaterThan(0);
        expect(normalUnit).not.toBe('m²');

        // 4) Da bo nut +/-: chi con o nhap so luong
        await expect(page.locator('#cart-table-container [title^="Tăng"]')).toHaveCount(0);
        await expect(page.locator('#cart-table-container [title^="Giảm"]')).toHaveCount(0);

        // 5) O so luong dung style o sua chung: co viền, cao 32px, bo cong 8px (rounded-lg)
        const qtyBox = await box(normalRow.locator('input[aria-label^="Số lượng"]'));
        expect(qtyBox.border).not.toBe('rgba(0, 0, 0, 0)');
        expect(qtyBox.height).toBe('32px');
        expect(qtyBox.radius).toBe('8px');
    });

    test('mobile: chi con o so luong, khong con nut +/-', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 390, height: 844 });
        await login(page);

        await addProduct(page, 'keo');
        await page.locator('#btn-pos-mobile-cart').click();
        const list = page.locator('#cart-record-list');
        await expect(list).toBeVisible({ timeout: 15_000 });

        const input = list.locator('input[aria-label^="Số lượng"]').first();
        expect(await input.count()).toBeGreaterThan(0);
        // Khong con nut +/- trong sheet mobile
        await expect(list.locator('[aria-label^="Tăng số lượng"]')).toHaveCount(0);
        await expect(list.locator('[aria-label^="Giảm số lượng"]')).toHaveCount(0);

        // Cung style o sua chung voi desktop
        const qtyBox = await box(input);
        expect(qtyBox.height).toBe('32px');
        expect(qtyBox.border).not.toBe('rgba(0, 0, 0, 0)');
    });
});
