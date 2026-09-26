import { test, expect, type Page } from '@playwright/test';

// Chẩn đoán + hồi quy: Báo cáo hội tụ sau bán hàng (live, tự dọn bằng hủy đơn).
// Dùng quyền admin vì menu Báo cáo ẩn với thu ngân/worker.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'admin@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Admin@123';

const num = (s: string) => Number((s || '').replace(/[^\d]/g, '')) || 0;

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
}

async function gotoScreen(page: Page, item: string, view: string) {
  await page.keyboard.press('Alt+m');
  await expect(page.locator('#flyout-overlay')).toBeVisible({ timeout: 10_000 });
  await page.locator(item).click();
  await expect(page.locator(view)).toBeVisible({ timeout: 15_000 });
}

async function revenueKpi(page: Page): Promise<number> {
  const val = page.locator('#reports-view .text-blue-900.font-extrabold').first();
  await expect(val).toBeVisible({ timeout: 15_000 });
  return num(await val.innerText());
}

async function todayBarRevenue(page: Page): Promise<number> {
  const titles = page.locator('#reports-view svg[aria-label="Doanh thu 14 ngày gần nhất"] g title');
  const n = await titles.count();
  if (n === 0) return 0;
  // Mỗi ngày 2 title (Doanh thu + Thực thu); ngày hôm nay = cặp cuối, title đầu.
  // SVG <title> không có innerText -> dùng textContent.
  const t = (await titles.nth(n - 2).textContent()) || '';
  const m = t.match(/Doanh thu:\s*(.+)/);
  return num(m?.[1] || '');
}

test.describe('báo cáo hội tụ sau bán', () => {
  test('KPI + chart cập nhật đúng số tiền đơn mới rồi ổn định', async ({ page }) => {
    await login(page);
    // Ép 1 nhịp đồng bộ qua Trung tâm đồng bộ để baseline đọc sau khi đã hydrate (tránh baseline = 0).
    await page.locator('#header-sync-center-btn').click();
    const syncNow = page.getByRole('button', { name: 'Đồng bộ ngay' });
    await expect(syncNow).toBeEnabled({ timeout: 30_000 });
    await syncNow.click();
    await expect(syncNow).toBeEnabled({ timeout: 30_000 });
    await page.locator('button[aria-label="Đóng trung tâm đồng bộ"]').first().click();
    await expect(page.getByRole('dialog', { name: 'Trung tâm đồng bộ' })).toHaveCount(0);
    await gotoScreen(page, '#menu-item-reports', '#reports-view');
    // Baseline khi số liệu đã ổn định (2 lần đọc liên tiếp bằng nhau, tối đa 15s).
    // Shop đang bán thật nên baseline có thể trôi — assert theo delta >= payable.
    let base = await revenueKpi(page);
    const steadyDeadline = Date.now() + 15_000;
    while (Date.now() < steadyDeadline) {
      await page.waitForTimeout(1000);
      const v = await revenueKpi(page);
      if (v === base) break;
      base = v;
    }

    // Bán 1 món goods cash (đảm bảo ca mở; form ca hydrate async nên chờ ổn định).
    await gotoScreen(page, '#menu-item-pos', '#pos-screen');
    {
      const overlay = page.locator('#shift-modal-overlay');
      const openBtn = page.locator('#btn-confirm-open-shift');
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.locator('#header-shift-btn').click();
        await expect(overlay).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(2000);
        const needsOpen = await openBtn.isVisible().catch(() => false);
        if (!needsOpen) {
          if (await overlay.isVisible().catch(() => false)) {
            await page.locator('#shift-modal-container button').first().click().catch(() => {});
          }
          break;
        }
        try {
          await openBtn.click({ timeout: 8000 });
          await expect(overlay).toBeHidden({ timeout: 15_000 });
          break;
        } catch {
          // Flip giữa chừng -> vòng sau đọc lại trạng thái mới.
        }
      }
    }
    const search = page.locator('#f1-search-input');
    let added = false;
    for (const term of ['a', 'e', 'o', '0', '1']) {
      await search.fill(term);
      try {
        await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
      } catch {
        continue;
      }
      const items = page.locator('#search-results-dropdown div[id^="search-item-"]');
      const n = Math.min(await items.count(), 4);
      for (let i = 0; i < n; i++) {
        await items.nth(i).click();
        if (await page.locator('#dimension-modal-overlay').isVisible()) {
          await page.locator('#btn-close-dimension-modal').click();
          await search.fill(term);
          try {
            await expect(page.locator('#search-results-dropdown')).toBeVisible({ timeout: 4_000 });
          } catch {
            break;
          }
          continue;
        }
        if ((await page.locator('#cart-table-container tbody tr').count().catch(() => 0)) > 0) {
          added = true;
          break;
        }
      }
      if (added) break;
    }
    expect(added).toBe(true);
    const payable = num(await page.locator('#payable-total-display').innerText());
    expect(payable).toBeGreaterThan(0);
    await page.locator('#payment-method-cash').click();
    await page.locator('#f9-tendered-input').fill(String(payable + 100000));
    await page.locator('#btn-pos-checkout').click();
    await expect(page.locator('#receipt-modal-overlay')).toBeVisible({ timeout: 30_000 });
    const title = await page.locator('#receipt-modal-container h3').innerText();
    const code = title.match(/HD-\d+-\d+/)?.[0];
    expect(code).toBeTruthy();
    await page.locator('#receipt-modal-container button', { hasText: 'Đóng' }).click();

    // Về Báo cáo: chờ KPI **và** chart cùng hội tụ (tối đa 45s).
    // Đọc chung 1 vòng để không so 2 lần đọc rời nhau giữa 2 nhịp realtime.
    await gotoScreen(page, '#menu-item-reports', '#reports-view');
    const target = base + payable;
    const trace: string[] = [];
    const deadline = Date.now() + 45_000;
    let kv = -1;
    let cv = -1;
    let last = -1;
    while (Date.now() < deadline) {
      kv = await revenueKpi(page);
      cv = await todayBarRevenue(page).catch(() => -1);
      if (kv !== last) {
        trace.push(`${kv}/${cv}`);
        last = kv;
      }
      if (kv >= target && cv >= target) break;
      await page.waitForTimeout(500);
    }
    console.log(`TRACE kpi/chart: base=${base} payable=${payable} trace=[${trace.join(' -> ')}]`);
    // Shop live có máy khác bán song song -> assert delta >=, không assert bằng tuyệt đối.
    expect(kv).toBeGreaterThanOrEqual(target);
    // Chart cột hôm nay phản ánh đúng doanh thu.
    expect(cv).toBeGreaterThanOrEqual(target);

    // Dọn: hủy đơn vừa bán.
    await gotoScreen(page, '#menu-item-orders', '#orders-view');
    await page.locator('#orders-view input[placeholder="Mã đơn, tên khách, SĐT..."]').fill(code!);
    const row = page.locator('#orders-view tbody tr', { hasText: code! }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await page.locator('#orders-view button', { hasText: 'Hủy hóa đơn & Hoàn quỹ' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Hủy đơn' }).click();
    await expect(page.locator('#orders-view span:text-is("Đã hủy")').first()).toBeVisible({ timeout: 30_000 });
  });
});
