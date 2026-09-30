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

/** Số tiền kiểu VN trong ô nội dung dòng: "45.000" -> 45000. */
const vnNum = (raw: string | undefined): number => Number((raw || '').replace(/\./g, ''));

/**
 * Tồn còn lại phải bằng đúng (tồn gốc - SL xuất). Tồn gốc đọc từ cột "Tồn: N" của
 * chính dòng đó, KHÔNG hardcode: DB dùng chung nên tồn đổi theo vận động thật.
 */
function expectStockAfter(detail: string, qty: number) {
    const base = vnNum(detail.match(/Tồn:\s*([\d.,]+)/)?.[1]);
    const after = vnNum(detail.match(/([\d.,]+)\s+\S+\s*$/)?.[1]);
    expect(Number.isFinite(base)).toBe(true);
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBe(base - qty);
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
        // 3 x 15.000 = 45.000; tồn còn lại = tồn gốc - 3
        expect(detail).toContain('45.000 đ');
        expectStockAfter(detail, 3);
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

    test('Enter ở ô tìm nhảy ô số lượng, Enter tiếp mới ghi dòng (giống bán hàng)', async ({ page }) => {
        // Yêu cầu: Nhập hàng + xuất vật tư không được mặc định 1. Enter lần 1 chỉ chọn
        // hàng rồi nhảy focus sang #quick-quantity-input; Enter lần 2 mới thêm dòng với SL đã gõ.
        for (const flow of ['Xuất CT', 'Nhập hàng'] as const) {
            test.slow();
            await page.setViewportSize({ width: 1600, height: 950 });
            await loginAdmin(page);
            await page.locator(`button:has-text("${flow}")`).click();
            await page.waitForTimeout(900);

            const table = flow === 'Xuất CT' ? '#project-table-container' : '#import-table-container';
            const rows = page.locator(`${table} tbody tr`);
            expect(await rows.count()).toBe(0);

            const search = page.locator('#f1-search-input');
            await search.fill('keo');
            await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 10_000 });
            // Gợi ý phím phải nói đúng việc sẽ làm (không còn "[Enter] Mở F3" ở 2 luồng kho)
            await expect(page.locator('#search-results-dropdown')).toContainText('[Enter] Nhập SL');
            await search.press('Enter');

            // Chưa ghi dòng, con trỏ đã nhảy sang ô số lượng
            const qtyBox = page.locator('#quick-quantity-input');
            await expect(qtyBox).toBeFocused({ timeout: 5_000 });
            expect(await rows.count()).toBe(0);

            // Gõ SL rồi Enter mới ghi dòng
            await qtyBox.fill('2');
            await qtyBox.press('Enter');
            await expect(rows).toHaveCount(1, { timeout: 10_000 });
            const detail = (await rows.first().innerText()).replace(/\s+/g, ' ');
            // thành tiền = 2 x 15.000 = 30.000; tồn còn lại = tồn gốc - 2 (Xuất CT)
            expect(detail).toContain('30.000 đ');
            if (flow === 'Xuất CT') expectStockAfter(detail, 2);
            // Enter xong quay lại ô tìm như luồng bán hàng
            await expect(page.locator('#f1-search-input')).toBeFocused();
        }
    });

    test('ô số lượng Xuất CT và Nhập hàng dùng chung style ô sửa của giỏ bán', async ({ page }) => {
        // Quy ước style (components/common/EditableCell): ô sửa được KHÔNG viền, KHÔNG nền,
        // chữ xanh blue-600; hover/focus chỉ đổi độ đậm/màu chữ. Nhập hàng + Xuất CT
        // trước đây dùng NumberInput có viền -> lệch với trang bán hàng.
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);

        const style = (loc: ReturnType<Page['locator']>) =>
            loc.evaluate((el: HTMLElement) => {
                const cs = getComputedStyle(el);
                return {
                    bg: cs.backgroundColor,
                    color: cs.color,
                    border: cs.borderTopWidth,
                    height: cs.height,
                    weight: cs.fontWeight,
                    shadow: cs.boxShadow,
                };
            });

        // 1) lấy mẫu chuẩn từ giỏ bán
        await addFirstProduct(page, 'keo');
        const cartQty = page.locator('#cart-table-container tbody tr').first().locator('input[aria-label^="Số lượng"]');
        const cartStyle = await style(cartQty);
        expect(cartStyle.border).toBe('0px');
        expect(cartStyle.bg).toBe('rgba(0, 0, 0, 0)');
        expect(cartStyle.color).toBe('oklch(0.546 0.245 262.881)'); // blue-600

        // 2) Xuất CT phải y hệt
        await page.locator('button:has-text("Xuất CT")').click();
        await page.waitForTimeout(700);
        await addFirstProduct(page, 'keo');
        const projQty = page.locator('#project-table-container tbody tr').first().locator('input[aria-label^="Số lượng xuất"]');
        await expect(projQty).toBeVisible();
        expect(await style(projQty)).toEqual(cartStyle);

        // 3) Nhập hàng: cả ô đơn giá lẫn ô số lượng cũng phải y hệt
        await page.locator('button:has-text("Nhập hàng")').click();
        await page.waitForTimeout(700);
        await addFirstProduct(page, 'keo');
        const impRow = page.locator('#import-table-container tbody tr').first();
        const impQty = impRow.locator('input[aria-label^="Số lượng nhập"]');
        const impPrice = impRow.locator('input').first();
        await expect(impQty).toBeVisible();
        expect(await style(impQty)).toEqual(cartStyle);
        const priceStyle = await style(impPrice);
        expect(priceStyle.border).toBe('0px');
        expect(priceStyle.bg).toBe('rgba(0, 0, 0, 0)');
        expect(priceStyle.color).toBe(cartStyle.color);
        expect(priceStyle.height).toBe(cartStyle.height);
    });

    test('trang Công trình có nút Xuất CT nhảy thẳng POS, chọn sẵn công trình', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);

        // Alt + J sang màn Công trình
        await page.keyboard.press('Alt+KeyJ');
        await expect(page.locator('#projects-view')).toBeVisible({ timeout: 20_000 });
        const goBtn = page.locator('#btn-project-goto-export');
        await expect(goBtn).toBeVisible();
        // Nhãn theo bố cục mới của trang Công trình: "Xuất vật tư →"
        await expect(goBtn).toHaveText(/Xuất vật tư/);
        // Dòng hướng dẫn cũ đã bị thay bằng nút bấm được
        await expect(page.locator('#projects-view')).not.toContainText('Xuất vật tư tại màn POS');

        await goBtn.click();
        await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('#project-table-container')).toBeVisible({ timeout: 20_000 });
        // Công trình đã chọn sẵn -> nút commit chỉ còn chặn vì chưa có vật tư
        await expect(page.locator('#pos-payment-panel')).not.toContainText('Phải chọn công trình trước khi xuất');
        expect(await page.locator('#btn-project-export-commit').isDisabled()).toBe(true); // chưa có dòng
    });
});
