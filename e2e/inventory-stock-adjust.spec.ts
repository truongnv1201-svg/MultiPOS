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

async function openAdjustTab(page: Page) {
    // Sổ điều chỉnh sống ở tab Điều chỉnh của trang Quản lý Chứng từ.
    await page.keyboard.press('Alt+m');
    await page.locator('#menu-item-vouchers').click();
    await page.locator('#vouchers-tab-adjust').click();
    await expect(page.locator('#vouchers-view')).toBeVisible({ timeout: 20_000 });
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

        // Thẻ kho có thêm bộ lọc 2 loại điều chỉnh (0064)
        const filter = page.locator('select').filter({ has: page.locator('option[value="adjust_loss"]') });
        await expect(filter).toBeVisible();
        await expect(filter.locator('option[value="adjust_loss"]')).toHaveCount(1);
        await expect(filter.locator('option[value="adjust_gain"]')).toHaveCount(1);

        // Tab sổ điều chỉnh tồn ở trang Chứng từ, nhãn tab không mang chip đếm
        await openAdjustTab(page);
        await expect(page.locator('#vouchers-tab-adjust')).not.toContainText('chưa gán');
        // Rỗng thì hiện lời mời ghi phiếu (không crash khi RPC chưa có bảng)
        const hasEmpty = await page.locator('text=Chưa có phiếu điều chỉnh tồn nào').count();
        if (hasEmpty === 0) {
            // Style chuẩn như 2 bảng chính: thanh tìm kiếm + dòng tổng hợp
            await expect(page.locator('#adjust-search-input')).toBeVisible();
            await expect(page.locator('text=phiếu dòng').first()).toBeVisible();
            // Tìm kiếm lọc được dòng (bảng desktop; bản mobile ẩn ở màn hình này)
            await page.locator('#adjust-search-input').fill('zzz-khong-ton-tai-zzz');
            await expect(page.locator('td:has-text("Không tìm thấy phiếu điều chỉnh nào")')).toBeVisible();
            await page.locator('#adjust-search-input').fill('');
        } else {
            expect(hasEmpty).toBeGreaterThan(0);
        }
    });

    test('cả 2 tab đều có nút Xuất Excel và In ấn', async ({ page }) => {
        // Sổ điều chỉnh tồn là bằng chứng đối chiếu tồn thực — phải mang đi được (in/xuất).
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await openInventory(page);

        const tools = page.locator('#inventory-view button[title*="Excel" i], #inventory-view button[title*="In" i], #inventory-view button[title*="in ấn" i]');
        // Tab Nhật ký thẻ kho (mặc định)
        await expect(tools.first()).toBeVisible();
        const movementCount = await tools.count();
        expect(movementCount).toBeGreaterThanOrEqual(2);

        // Tab Điều chỉnh tồn (trang Chứng từ)
        await openAdjustTab(page);
        const adjustTools = page.locator('#vouchers-view button[title*="Excel" i], #vouchers-view button[title*="In" i], #vouchers-view button[title*="in ấn" i]');
        await expect(adjustTools.first()).toBeVisible();
    });

    test('1 lần lập phiếu không được sinh 2 dòng giống nhau trong sổ điều chỉnh', async ({ page }) => {
        // Regression thật: trước đây dòng local (id giả "adj-...") và dòng server (uuid)
        // khác id nên mỗi phiếu hiện 2 dòng y hệt nhau. Sửa bằng clientRef ổn định.
        // Test này chỉ kiểm giao diện: số dòng render ra phải khớp số phiếu trên server,
        // nên nó cần DB sạch — dùng dữ liệu sẵn có, không ghi phiếu mới.
        test.slow();
        await page.setViewportSize({ width: 1600, height: 950 });
        await loginAdmin(page);
        await openAdjustTab(page);
        await page.waitForTimeout(2500);

        const rows = page.locator('#vouchers-view tbody tr');
        const n = await rows.count();
        if (n === 0) return; // DB chưa có phiếu nào -> không có gì để kiểm
        // Không được có 2 dòng liên tiếp cùng mã phiếu + cùng SKU + cùng thời điểm
        const seen = new Set<string>();
        for (let i = 0; i < n; i++) {
            const text = (await rows.nth(i).innerText()).replace(/\s+/g, ' ');
            const code = text.split(' ')[0] || '';
            if (seen.has(code)) {
                throw new Error(`Phát hiện dòng trùng mã phiếu ${code} trong sổ điều chỉnh:\n${text}`);
            }
            seen.add(code);
        }
    });
});
