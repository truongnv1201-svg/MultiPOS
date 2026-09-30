import { test, expect, type Page } from '@playwright/test';

// Đo bố cục thật của header các trang danh mục: nút chính phải SÁT mép phải, cụm nút
// phụ (Excel/In/Mẫu/Nhập) nằm ngay bên trái nó, và không nhãn tổng tiền nào chen vào
// giữa cụm nút (đó là nguyên nhân làm nút chính bị đẩy lệch trái).

const PAGES = [
  { name: 'NCC', shortcut: 'Alt+k', main: '#btn-add-supplier', view: '#suppliers-view' },
  { name: 'Khách hàng', shortcut: null, mainText: 'Thêm khách hàng mới', view: '#customers-view' },
  { name: 'Hàng hóa', shortcut: null, main: '#btn-open-add-product-modal', view: '#products-view' },
  { name: 'Đơn hàng', shortcut: null, mainText: 'Tạo đơn bán hàng', view: '#orders-view' },
  { name: 'Công trình', shortcut: 'Alt+j', mainText: 'Lập dự án công trình mới', view: '#projects-view' },
  { name: 'Kho', shortcut: 'Alt+n', mainText: 'Tạo Phiếu Nhập Kho', view: '#inventory-view' },
  { name: 'Sổ quỹ', shortcut: null, mainText: 'Lập Phiếu Chi', view: null },
];

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

/** Mở màn qua menu phân hệ bằng tên hiển thị trong FlyoutMenu. */
async function openScreen(page: Page, label: RegExp) {
    await page.locator('#header-menu-btn, button:has-text("Menu")').first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: label }).first().click();
    await page.waitForTimeout(2000);
}

const MENU_LABEL: Record<string, RegExp> = {
    'NCC': /Cung Cấp/i,
    'Khách hàng': /Khách Hàng/i,
    'Hàng hóa': /Hàng Hóa|Danh Mục/i,
    'Đơn hàng': /Đơn Hàng/i,
    'Công trình': /Công Trình|Dự Án/i,
    'Kho': /Kho Hàng|Kho Vận/i,
    'Sổ quỹ': /Sổ Quỹ/i,
};

test.describe('Header các trang danh mục: nút chính sát lề phải', () => {
    for (const p of PAGES) {
        test(`${p.name}: nút chính sát mép phải, nút phụ nằm cạnh`, async ({ page }) => {
            test.slow();
            await page.setViewportSize({ width: 1600, height: 950 });
            await loginAdmin(page);
            if (p.shortcut) {
                await page.keyboard.press(p.shortcut);
                await page.waitForTimeout(2200);
            } else {
                await openScreen(page, MENU_LABEL[p.name]);
            }
            if (p.view) {
                await expect(page.locator(p.view)).toBeVisible({ timeout: 25_000 });
            }

            // Nút chính = nút khớp theo id, nếu không có thì tìm theo chữ
            const main = p.main
                ? page.locator(p.main)
                : page.locator('button:has-text("' + p.mainText + '")').first();
            await expect(main).toBeVisible({ timeout: 20_000 });

            // Đo CẢ cụm nút phải của header (lấy header từ chính nút chính để không chọn nhầm
            // header của màn khác đang ẩn), rồi kiểm:
            //   1) nút chính là nút NGOÀI CÙNG bên phải, mép phải = padding của header
            //   2) các nút trong cụm liền mạch (mọi khoảng cách ngang <= 24px) -> nút phụ
            //      nằm ngay cạnh nút chính, không bị chen bởi nhãn tổng tiền
            const measured = await main.evaluate((el: HTMLElement, mainSel: string | null) => {
                const header = el.closest('div.h-14') as HTMLElement;
                const padRight = parseFloat(getComputedStyle(header).paddingRight);
                const hr = header.getBoundingClientRect();
                // Cụm nút phải = container cha của nút chính (không dùng querySelector
                // vì các màn khác vẫn còn trong DOM dù đang ẩn).
                const group = el.parentElement as HTMLElement;
                const items = Array.from(group.querySelectorAll('button, label')) as HTMLElement[];
                const cluster = items
                    .map((n) => ({ el: n, r: n.getBoundingClientRect() }))
                    .filter((x) => x.r.width > 0)
                    .sort((a, b) => a.r.left - b.r.left);
                return {
                    padRight,
                    groupRightGap: hr.right - group.getBoundingClientRect().right,
                    rightGap: hr.right - cluster[cluster.length - 1].r.right,
                    cluster: cluster.map((x) => ({
                        left: x.r.left,
                        right: x.r.right,
                        top: x.r.top,
                        height: x.r.height,
                        text: (x.el.textContent || '').trim().slice(0, 30),
                    })),
                    mainIndex: mainSel ? cluster.findIndex((x) => x.el.matches(mainSel)) : -1,
                };
            }, p.main ?? null);

            expect(measured.cluster.length, 'phải có cụm nút ở mép phải header').toBeGreaterThan(1);
            const last = measured.cluster[measured.cluster.length - 1];
            console.log(
                `${p.name}: cụm = ${measured.cluster.map((c) => '"' + c.text + '"').join(' | ')} | rightGap=${measured.rightGap}`
            );
            // 1) nút chính sát lề phải (mép phải nút == mép phải header trừ padding)
            expect(
                Math.abs(measured.rightGap - measured.padRight),
                'nút ngoài cùng bên phải phải sát lề phải header'
            ).toBeLessThanOrEqual(2);
            if (p.main) {
                expect(measured.mainIndex, `nút chính ${p.main} phải nằm trong cụm`).toBe(measured.cluster.length - 1);
            } else {
                expect(last.text, `nút chính "${p.mainText ?? ''}" phải là nút ngoài cùng bên phải`).toContain(
                    (p.mainText ?? '').slice(0, 12)
                );
            }
            // 2) cụm liền mạch: không có nhãn/badge nào chen giữa
            for (let i = 1; i < measured.cluster.length; i++) {
                const dx = measured.cluster[i].left - measured.cluster[i - 1].right;
                // So tâm theo chiều dọc chứ không so mép trên: các nút khác cao (nút tab
                // py-1 vs nút hành động h-8) nhưng vẫn nằm cùng hàng flex items-center.
                const dy = Math.abs(
                    (measured.cluster[i].top + measured.cluster[i].height / 2) -
                    (measured.cluster[i - 1].top + measured.cluster[i - 1].height / 2)
                );
                expect(
                    dx,
                    `khoảng hở ${dx.toFixed(0)}px giữa "${measured.cluster[i - 1].text}" và "${measured.cluster[i].text}"`
                ).toBeLessThanOrEqual(24);
                expect(dy, 'các nút phải cùng một hàng').toBeLessThan(6);
            }
            // 3) không còn nhãn tổng nợ chen trong header
            expect(await page.locator('div.h-14 span:has-text("Tổng nợ phải trả")').count()).toBe(0);
        });
    }
});
