import { test, expect, type Page } from '@playwright/test';

// 0064 — màn Kho: nút Điều chỉnh tồn, modal 2 cách nhập, tab sổ điều chỉnh.
//
// KHÔNG bấm "Ghi điều chỉnh" ở đây: test E2E chạy trên DB dùng chung, mà ghi phiếu thật
// sẽ đổi tồn kho + tạo dòng audit mà không có cách hoàn tác trong UI. Phần ghi server
// được kiểm bằng `npm run test:live:adjust` (scripts/verify-stock-adjust.mjs), script đó
// tự dọn sạch cả tồn lẫn phiếu.

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

async function openInventory(page: Page) {
    // Kho nằm ở phím tắt Alt + N (GlobalHeader) — dùng phím tắt để không phụ thuộc vị trí menu.
    await page.keyboard.press('Alt+n');
    await expect(page.locator('#inventory-view')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
}

test.describe('Kho: điều chỉnh tồn / hao hụt', () => {
    test('mở modal, chấn lệch tồn thực và xem tóm tắt phiếu trước khi ghi', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await openInventory(page);

        await page.click('#btn-stock-adjust-open');
        const modal = page.locator('[role="dialog"][aria-label="Điều chỉnh tồn kho"]');
        await expect(modal).toBeVisible();
        // Mặc định là cách "dán tồn thực tế" (anh chốt dùng cả hai)
        await expect(page.locator('#btn-adjust-mode-count')).toBeVisible();
        await expect(page.locator('#btn-adjust-mode-edit')).toBeVisible();
        // Lý do bắt buộc: có danh sách lý do, mặc định "Hư / hỏng"
        await expect(page.locator('#adjust-reason')).toHaveValue('damage');
        // Công trình là TÙY CHỌN: lựa chọn mặc định phải là kho (ô chọn hiển thị label đó)
        await expect(page.locator('#adjust-project-select input')).toHaveValue('Kho (chưa gán công trình)');

        // Chưa sửa gì -> nút ghi khoá (không ghi phiếu rỗng)
        await expect(page.locator('#btn-adjust-submit')).toBeDisabled();

        // Sửa 1 dòng: tồn thực = tồn hệ thống - 2 -> phải hiện chênh lệch -2 và giá trị hao hụt.
        // Lọc theo SKU "keo" (SP000015, tồn nguyên) để chênh lệch là số chẳng lẻ dễ đối chiếu.
        await page.locator('[role="dialog"] input[placeholder*="Lọc"]').fill('SP000015');
        const row = page.locator('[role="dialog"] tbody tr').first();
        await expect(row).toBeVisible();
        const firstCount = row.locator('input[id^="adjust-count-"]');
        const sysStock = Number((await firstCount.inputValue()).replace(/\./g, '').replace(',', '.'));
        expect(Number.isFinite(sysStock)).toBe(true);
        await firstCount.fill(String(sysStock - 2));
        await page.waitForTimeout(500);

        await expect(row).toContainText('-2');
        // Chân modal tóm tắt: 1 mặt hàng chênh lệch, mất 1, và nói rõ không ghi sổ quỹ
        await expect(modal).toContainText('1 mặt hàng chênh lệch');
        await expect(modal).toContainText('mất');
        await expect(modal).toContainText('không ghi vào sổ quỹ');
        await expect(page.locator('#btn-adjust-submit')).toBeEnabled();

        // Đóng không ghi gì: bấm "Xoá dòng nhập" rồi đóng
        await page.click('button:has-text("Xoá dòng nhập")');
        await expect(page.locator('#btn-adjust-submit')).toBeDisabled();
    });

    test('ô nhập sai bị chặn, không được coi như mất sạch kho', async ({ page }) => {
        // Regression: parseQtyInput trả 0 cho chuỗi rác. Nếu modal coi 0 là "tồn thực tế"
        // thì gõ nhầm một ký tự sẽ ra phiếu "mất toàn bộ tồn" — phải báo lỗi thay vì ghi.
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await openInventory(page);
        await page.click('#btn-stock-adjust-open');
        const modal = page.locator('[role="dialog"]');

        await page.locator('[role="dialog"] input[placeholder*="Lọc"]').fill('SP000015');
        const row = page.locator('[role="dialog"] tbody tr').first();
        const countInput = row.locator('input[id^="adjust-count-"]');
        await countInput.fill('abc');
        await page.waitForTimeout(400);
        await expect(row).toContainText('số không hợp lệ');
        // Không có dòng nào chờ ghi -> nút ghi vẫn khoá
        await expect(page.locator('#btn-adjust-submit')).toBeDisabled();

        // Sửa lại thành số hợp lệ thì mới tính chênh lệch
        await countInput.fill('0');
        await page.waitForTimeout(400);
        await expect(row).not.toContainText('số không hợp lệ');
        await expect(page.locator('#btn-adjust-submit')).toBeEnabled();
        await expect(modal).toContainText('mất');
    });

    test('cách nhập thứ hai: nhập thẳng số hao hụt / đếm thừa', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await openInventory(page);
        await page.click('#btn-stock-adjust-open');

        await page.click('#btn-adjust-mode-edit');
        await expect(page.locator('[role="dialog"]')).toContainText('Nhập số hao hụt');

        // -3 = mất 3, +2 = đếm thừa -> tóm tắt tách 2 nhóm
        const rows = page.locator('[role="dialog"] tbody tr');
        await rows.nth(0).locator('input[id^="adjust-delta-"]').fill('-3');
        await rows.nth(1).locator('input[id^="adjust-delta-"]').fill('2');
        await page.waitForTimeout(500);

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toContainText('2 mặt hàng chênh lệch');
        await expect(modal).toContainText('mất');
        await expect(modal).toContainText('thừa');
        await expect(page.locator('#btn-adjust-submit')).toBeEnabled();
    });

    test('có tab sổ điều chỉnh và cảnh báo mục chưa gán công trình', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await openInventory(page);

        // Tab thẻ kho có thêm bộ lọc 2 loại điều chỉnh (0064)
        await page.click('button:has-text("Nhật ký Thẻ kho")');
        const filter = page.locator('select').filter({ has: page.locator('option[value="adjust_loss"]') });
        await expect(filter).toBeVisible();
        await expect(filter.locator('option[value="adjust_loss"]')).toHaveCount(1);
        await expect(filter.locator('option[value="adjust_gain"]')).toHaveCount(1);

        // Tab sổ điều chỉnh tồn tồn tại
        await page.click('#btn-inventory-tab-adjustments');
        await page.waitForTimeout(1500);
        // Rỗng thì hiện lời mời ghi phiếu (không crash khi RPC chưa có bảng)
        const hasEmpty = await page.locator('text=Chưa có phiếu điều chỉnh tồn nào').count();
        const hasTable = await page.locator('text=Sổ điều chỉnh tồn').count();
        expect(hasEmpty + hasTable).toBeGreaterThan(0);
    });
});
