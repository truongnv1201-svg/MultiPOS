import { test, expect, type Page, type Locator } from '@playwright/test';

// Giỏ POS: mọi ô ĐƯỢC SỬA (số lượng, đơn giá) phải cùng một style ô input có khung
// (viền + nền trắng) để nhìn là biết sửa được — xem components/common/EditableCell.
// Ô chỉ đọc (đơn giá khi là thu ngân) KHÔNG khung, chữ xám để nhìn là biết quyền.
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
const weightOf = (loc: Locator) => loc.evaluate((el: HTMLElement) => getComputedStyle(el).fontWeight);
const shadowOf = (loc: Locator) => loc.evaluate((el: HTMLElement) => getComputedStyle(el).boxShadow);

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
        // Cả hai đều là ô nền hồng không viền (khác ô chỉ đọc xám trơn) và cùng chiều cao
        expect(qb.borderWidth).toBe('0px');
        expect(pb.borderWidth).toBe('0px');
        expect(qb.bg).toBe('oklch(0.969 0.015 12.422)'); // rose-50
        expect(pb.bg).toBe('oklch(0.969 0.015 12.422)');
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

    test('Ô sửa được nhìn là biết: nền hồng ôm sát chữ, không viền', async ({ page }) => {
        // Nguyên tắc: ô sửa được PHẢI có nền hồng để khác chữ tĩnh (không viền,
        // đệm gọn để nền ôm sát chữ); ô chỉ đọc (xám, không nền) thì không.
        // Phản hồi hover/focus đến từ nền + màu chữ + độ đậm. Mọi màu chữ đều
        // phải >= AA 4.5:1 trên nền hồng (số tiền phải đọc được).
        await page.setViewportSize({ width: 1600, height: 950 });
        await login(page, true);
        await addFirstProduct(page, 'keo');

        // canvas để oklch -> sRGB rồi tính WCAG (đọc thẳng getComputedStyle ra oklch chưa phải RGB)
        await page.addScriptTag({
            content: `window.__contrast = (cssColor) => {
                const c = document.createElement('canvas'); c.width = c.height = 1;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1, 1);
                ctx.fillStyle = cssColor; ctx.fillRect(0, 0, 1, 1);
                const d = ctx.getImageData(0, 0, 1, 1).data;
                const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                const L = 0.2126 * lin(d[0]) + 0.7152 * lin(d[1]) + 0.0722 * lin(d[2]);
                return Math.round((1.05 / (L + 0.05)) * 100) / 100;
            };`,
        });
        const contrast = async (loc: Locator) =>
            page.evaluate(
                (c) => (window as unknown as { __contrast: (x: string) => number }).__contrast(c),
                await colorOf(loc)
            );

        const row = page.locator('#cart-table-container tbody tr').first();
        for (const label of [/^Số lượng /, /^Đơn giá /]) {
            const input = row.getByLabel(label);
            await expect(input).toBeVisible();

            // nghỉ: không viền + nền hồng nhạt, chữ đỏ đọc được
            const restColor = await colorOf(input);
            expect(restColor).toBe('oklch(0.514 0.222 16.935)'); // rose-700
            expect(await contrast(input)).toBeGreaterThanOrEqual(4.5);
            const restBg = await bgOf(input);
            expect(restBg).toBe('oklch(0.969 0.015 12.422)'); // rose-50
            expect(await input.evaluate((el: HTMLElement) => getComputedStyle(el).borderTopWidth)).toBe('0px');
            expect(await shadowOf(input)).toBe('none');
            expect(await weightOf(input)).toBe('600');

            // hover: nền + chữ đều đổi -> nhảy rõ ràng
            await input.hover();
            await page.waitForTimeout(250);
            const hoverColor = await colorOf(input);
            expect(hoverColor).not.toBe(restColor);
            expect(hoverColor).toBe('oklch(0.41 0.159 10.272)'); // rose-900
            expect(await weightOf(input)).toBe('700');
            expect(await bgOf(input)).not.toBe(restBg);

            // focus (click vào): nền đậm hơn, không ring/viền
            await input.click();
            await page.waitForTimeout(250);
            expect(await shadowOf(input)).toBe('none');
            expect(await bgOf(input)).not.toBe(restBg);

            // rời chuột + blur -> về đúng trạng thái nghỉ
            await page.mouse.move(0, 0);
            await page.locator('#cart-table-container th', { hasText: 'Thành tiền' }).click();
            await page.waitForTimeout(250);
            expect(await colorOf(input)).toBe(restColor);
            expect(await weightOf(input)).toBe('600');
            expect(await bgOf(input)).toBe(restBg);
            expect(await shadowOf(input)).toBe('none');
        }
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
        // rose-700 (Tailwind v4) = oklch(0.514 0.222 16.935)
        expect(colorBefore).toBe('oklch(0.514 0.222 16.935)');
        await priceEdit.click();
        await priceEdit.fill('18500');
        await priceEdit.press('Enter');
        // blur ra xa để đo trạng thái nghỉ (đang focus thì màu đậm hơn)
        await page.locator('#cart-table-container th', { hasText: 'Thành tiền' }).click();
        await page.waitForTimeout(400);

        const colorAfter = await colorOf(priceEdit);
        expect(colorAfter).not.toBe(colorBefore);
        // hổ phách: amber-700 = oklch(0.555 0.163 48.998) — hue ~49 khác hẳn hue ~263 của
        // chữ xanh, và vẫn >= AA 5:1 nên số tiền đọc được
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
