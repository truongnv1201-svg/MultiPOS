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

type Box = { x: number; y: number; width: number; height: number };

/**
 * Nut -, o so luong va nut + phai cung chieu cao, lech trai/phai bang nhau,
 * can giua trong o va khong tran ra ngoai o (truoc day QtyDraftInput hardcode h-8
 * nen `h-6`/`h-9` o cho goi bi Tailwind de -> hang lech 8px desktop / 4px mobile).
 */
async function expectStepperAligned(
    minus: ReturnType<Page['locator']>,
    plus: ReturnType<Page['locator']>,
    input: ReturnType<Page['locator']>,
    cell: ReturnType<Page['locator']>
) {
    const [mb, pb, ib, cb] = (await Promise.all([
        minus.boundingBox(),
        plus.boundingBox(),
        input.boundingBox(),
        cell.boundingBox(),
    ])) as [Box, Box, Box, Box];

    expect(mb!.height).toBeCloseTo(pb!.height, 1);
    expect(mb!.height).toBeCloseTo(ib!.height, 1);
    expect(mb!.y).toBeCloseTo(pb!.y, 1);
    expect(mb!.y).toBeCloseTo(ib!.y, 1);

    const leftGap = ib!.x - (mb!.x + mb!.width);
    const rightGap = pb!.x - (ib!.x + ib!.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(0.6);

    const groupLeft = Math.min(mb!.x, pb!.x, ib!.x);
    const groupRight = Math.max(mb!.x + mb!.width, pb!.x + pb!.width, ib!.x + ib!.width);
    expect(cb!.x - groupLeft).toBeLessThanOrEqual(0.6);
    expect(groupRight - (cb!.x + cb!.width)).toBeLessThanOrEqual(0.6);
    expect(Math.abs((groupLeft + groupRight) / 2 - (cb!.x + cb!.width / 2))).toBeLessThan(1.5);
}

test.describe('Gio POS: cot don vi tinh + can nut +/-', () => {
    test('desktop: co cot DVT (m2 cho hang dien tich) va nut +/- thang hang', async ({ page }) => {
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
        const normalRow = rows.filter({ has: page.locator('[title^="Tăng"]') }).first();
        expect(await normalRow.count()).toBeGreaterThan(0);
        const normalUnit = (await normalRow.locator('td').nth(2).innerText()).trim();
        expect(normalUnit.length).toBeGreaterThan(0);
        expect(normalUnit).not.toBe('m²');

        // 4) Nut -, o so luong, nut + thang hang
        await expectStepperAligned(
            normalRow.locator('[title^="Giảm"]'),
            normalRow.locator('[title^="Tăng"]'),
            normalRow.locator('input'),
            normalRow.locator('td').nth(4)
        );
    });

    test('mobile: o so luong cung chieu cao voi nut +/-', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 390, height: 844 });
        await login(page);

        await addProduct(page, 'keo');
        await page.locator('#btn-pos-mobile-cart').click();
        const list = page.locator('#cart-record-list');
        await expect(list).toBeVisible({ timeout: 15_000 });

        const row = list.locator('[aria-label^="Tăng số lượng"]').first();
        expect(await row.count()).toBeGreaterThan(0);
        const input = row.locator('xpath=..').locator('input[type="text"]').first();
        expect(await input.count()).toBeGreaterThan(0);

        const minus = row.locator('xpath=preceding-sibling::button[1]');
        const [mb, ib] = (await Promise.all([minus.boundingBox(), input.boundingBox()])) as [
            Box,
            Box,
        ];
        expect(ib!.height).toBeCloseTo(mb!.height, 1);
        expect(ib!.y).toBeCloseTo(mb!.y, 1);
    });
});
