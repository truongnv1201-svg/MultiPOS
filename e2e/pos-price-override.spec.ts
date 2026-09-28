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
    test('sửa giá thì payload thanh toán PHẢI mang price_override', async ({ page }) => {
        // Regression bug thật: client tự so giá với products.retail_price để quyết định
        // gửi price_override. Chỉ cần tra trượt catalog (id local/offline, mirror cũ) là
        // cờ rơi im lặng -> server lấy giá danh mục -> hoá đơn in ra sai giá.
        // Nay client bật cờ thẳng khi người dùng sửa giá, nên payload luôn có price_override.
        test.slow();
        await page.setViewportSize({ width: 1440, height: 900 });

        let payload: any = null;
        // Chặn RPC và abort -> xem payload mà KHÔNG tạo đơn rác trên DB
        await page.route('**/rest/v1/rpc/pos_checkout', async (route) => {
            payload = JSON.parse(route.request().postData() || '{}');
            await route.abort('aborted');
        });

        await login(page, ADMIN_ID, ADMIN_PW);
        await addFirstProduct(page, 'keo');

        const row = page.locator('#cart-table-container tbody tr').first();
        await row.getByLabel(/^Đơn giá /).click();
        await row.getByLabel(/^Đơn giá /).fill('15000');
        await row.getByLabel(/^Đơn giá /).press('Enter');
        await expect(row.getByLabel(/^Đơn giá /)).toHaveAttribute('title', /Đã sửa đơn giá/);

        // trả đủ tiền mặt để không bị chặn "khách lẻ không được ghi nợ"
        const tendered = page.locator('#f9-tendered-input');
        await tendered.click();
        await tendered.fill('15000');
        await tendered.press('Tab');

        await page.locator('#btn-pos-checkout').click();
        await expect.poll(() => payload !== null, { timeout: 30_000 }).toBe(true);

        const items = payload!.p_items || [];
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].price_override).toBe(15000);
        expect(items[0].unit_price).toBe(15000);
    });

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
        const priceInput = row.getByLabel(/^Đơn giá /);
        await expect(priceInput).toBeVisible();

        const subtotalCell = row.locator('td').nth(6);
        const subtotalBefore = await subtotalCell.innerText();
        const priceBefore = await priceInput.inputValue();
        const original = priceBefore.replace(/[^\d.]/g, '').replace(/\./g, '');

        // Gõ giá mới (ô luôn hiện sẵn, không cần bấm mở)
        await priceInput.click();
        await priceInput.fill('15000');
        await priceInput.press('Enter');

        // Ô hiện giá format VN, thành tiền dòng chạy theo (qty 1 -> 15.000)
        await expect(priceInput).toHaveValue('15.000');
        await expect(subtotalCell).not.toHaveText(subtotalBefore);
        await expect(subtotalCell).toContainText('15.000');
        await expect(priceInput).toHaveAttribute('title', /Đã sửa đơn giá/);

        // Gõ lại đúng giá danh mục -> bỏ dấu "đã sửa" (server sẽ lấy giá catalog)
        await priceInput.click();
        await priceInput.fill(original);
        await priceInput.press('Enter');
        await expect(priceInput).toHaveAttribute('title', /Sửa đơn giá/);
        await expect(subtotalCell).toHaveText(subtotalBefore);
    });
});
