import { test, expect, type Page, type Locator } from '@playwright/test';

// Giỏ POS: mọi ô ĐƯỢC SỬA (số lượng, đơn giá) phải cùng một style, lấy theo convention
// form hàng hóa (NumberInput trong AddProductFormModal) — xem components/common/EditableCell.
// Ô chỉ đọc (đơn giá khi là thu ngân) phải KHÁC style ô sửa được để nhìn là biết quyền.
async function login(page: Page, admin = false) {
    await page.goto('/');
    await expect(page.locator('#login-modal-overlay')).toBeVisible();
    await page.fill('#login-id-input', admin ? process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local' : process.env.E2E_LOGIN_ID || 'cashier@multipos.local');
    await page.fill('#login-password-input', admin ? process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123' : process.env.E2E_LOGIN_PASSWORD || 'Cashier@123');
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

type Box = { bg: string; color: string; borderWidth: string; borderStyle: string; height: string; radius: string; font: string };
const box = (loc: Locator) =>
    loc.evaluate((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        return {
            bg: cs.backgroundColor,
            color: cs.color,
            borderWidth: cs.borderTopWidth,
            borderStyle: cs.borderTopStyle,
            height: cs.height,
            radius: cs.borderTopLeftRadius,
            font: cs.fontFamily,
        } as Box;
    });

/** So sánh "cùng style": bỏ qua màu chữ (nội dung khác nhau) và màu nền cảnh báo. */
function sameEditableStyle(a: Box, b: Box) {
    expect({ ...a, color: '', bg: '' }).toEqual({ ...b, color: '', bg: '' });
}

const bgOf = (loc: Locator) => loc.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
const colorOf = (loc: Locator) => loc.evaluate((el: HTMLElement) => getComputedStyle(el).color);

test.describe('Giỏ POS: style chung cho ô sửa được', () => {
    test('Quản lý: ô số lượng và ô đơn giá cùng style', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page, true);
        await addFirstProduct(page, 'ổ cắm');

        const row = page.locator('#cart-table-container tbody tr').first();
        const qty = row.locator('input[aria-label^="Số lượng"]');
        const price = row.locator('input[aria-label^="Đơn giá"]');
        await expect(qty).toBeVisible();
        await expect(price).toBeVisible();

        const [qb, pb] = [await box(qty), await box(price)];
        console.log('SL=' + JSON.stringify(qb));
        console.log('DG=' + JSON.stringify(pb));
        sameEditableStyle(qb, pb);
        // Cả hai đều có viền (khác ô chỉ đọc) và cùng chiều cao
        expect(qb.borderStyle).toBe('solid');
        expect(pb.borderStyle).toBe('solid');
        expect(qb.height).toBe(pb.height);
    });

    test('Ô đơn giá hiện dấu phân cách nghìn kiểu VN và sửa được bằng cách gõ', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page, true);
        await addFirstProduct(page, 'ổ cắm');

        const row = page.locator('#cart-table-container tbody tr').first();
        const price = row.locator('input[aria-label^="Đơn giá"]');
        const subtotal = row.locator('td').nth(6);

        // Gõ 15000 -> hiện 15.000 (không phải 1.5000)
        await price.click();
        await price.fill('15000');
        await price.press('Enter');
        await expect(price).toHaveValue('15.000');
        await expect(subtotal).toContainText('15.000');
        await expect(price).toHaveAttribute('title', /Đã sửa đơn giá/);

        // Giá 0 không được tạo ra: xoá hết thì giữ giá cũ
        await price.click();
        await price.fill('');
        await price.press('Tab');
        await expect(price).toHaveValue('15.000');
    });

    test('Ô đã sửa giá phải NHÌN THẤY khác ô bình thường', async ({ page }) => {
        // Regression: ô sửa giá đổi CHỮ sang hổ phách, nhưng EDIT_CELL_CLASS đã có
        // text-blue-700 và Tailwind xếp utility theo thứ tự -> không có `!` thì màu không
        // bao giờ thắng và cảnh báo "đã sửa giá" vô hình. Test đo computed style thật.
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page, true);
        await addFirstProduct(page, 'keo');
        await addFirstProduct(page, 'ổ cắm');

        const rowNormal = page.locator('#cart-table-container tbody tr').first();
        const rowEdit = page.locator('#cart-table-container tbody tr').nth(1);
        const priceEdit = rowEdit.locator('input[aria-label^="Đơn giá"]');

        const colorBefore = await colorOf(rowNormal.locator('input[aria-label^="Đơn giá"]'));
        // blue-700 (Tailwind v4) = oklch(0.488 0.243 264.376)
        expect(colorBefore).toBe('oklch(0.488 0.243 264.376)');
        await priceEdit.click();
        await priceEdit.fill('18500');
        await priceEdit.press('Enter');
        // blur ra xa để đo trạng thái nghỉ (đang focus thì màu đậm hơn)
        await page.locator('#cart-table-container th', { hasText: 'Thành tiền' }).click();
        await page.waitForTimeout(400);

        const colorAfter = await colorOf(priceEdit);
        expect(colorAfter).not.toBe(colorBefore);
        // hổ phách: amber-700 (Tailwind v4) = oklch(0.555 0.163 48.998) — hue ~49 khác hẳn
        // hue ~264 của chữ xanh -> mắt phân biệt được, không cần thêm khung/gạch chân
        expect(colorAfter).toBe('oklch(0.555 0.163 48.998)');

        // Khi đang gõ, chữ phải đậm hơn (phản hồi focus) thay vì đổi hue
        await priceEdit.click();
        await page.waitForTimeout(300);
        const colorFocused = await colorOf(priceEdit);
        expect(colorFocused).not.toBe(colorAfter);
    });

    test('Thu ngân: đơn giá chỉ đọc, khác style ô sửa được', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page, false);
        await addFirstProduct(page, 'ổ cắm');

        const row = page.locator('#cart-table-container tbody tr').first();
        // Không có ô nhập đơn giá cho thu ngân
        await expect(row.locator('input[aria-label^="Đơn giá"]')).toHaveCount(0);
        // Nhưng ô số lượng thì vẫn sửa được
        await expect(row.locator('input[aria-label^="Số lượng"]')).toBeVisible();

        const priceCell = row.locator('td').nth(3);
        const readOnlySpan = priceCell.locator('span[title]');
        await expect(readOnlySpan).toHaveAttribute('title', /Chỉ Quản lý\/Admin/);
        const readOnly = await readOnlySpan.evaluate((el: HTMLElement) => getComputedStyle(el).borderTopWidth);
        expect(readOnly).toBe('0px');
    });
});
