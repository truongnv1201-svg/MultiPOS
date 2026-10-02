import { test, expect, type Page } from '@playwright/test';

// Poll đồng bộ thích ứng (lib/store.tsx + lib/store/tx/constants.ts):
//   realtime sống + không còn hàng chờ đẩy -> 120s
//   realtime rớt, hoặc còn hàng chờ đẩy   -> 15s
// Realtime (postgres_changes) đã subscribe event '*' cho đúng các bảng này, nên poll
// chỉ là lưới an toàn. Đo trước khi đổi: poll 15s vô điều kiện tải 32 request / ~1,9 MB
// mỗi 60s chỉ để đứng yên (~115 MB/giờ) mà không thêm độ tươi nào.
//
// Bài test giữ 3 bằng chứng cùng lúc, vì giảm tần suất chỉ được chấp nhận khi dữ liệu
// máy khác vẫn về nhanh: (1) realtime, (2) lưu lượng đứng yên, (3) quay lại tab vẫn đồng bộ.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function loginAsCashier(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  // Chờ realtime kết nối (badge "trực tiếp") để poll chuyển sang nhịp dài
  await expect(page.locator('#header-sync-center-btn')).toHaveAttribute('title', /trực tiếp/i, { timeout: 30_000 });
}

test.describe('poll thích ứng theo realtime', () => {
  test('dữ liệu máy khác vẫn về nhanh, lưu lượng đứng yên giảm mạnh', async ({ page, browser }) => {
    test.slow(); // có đo 60s đứng yên + 8s chờ focus

    // Máy A: máy đang đo lưu lượng
    const calls = new Map<string, { calls: number; bytes: number }>();
    page.on('response', (res) => {
      const m = res.url().match(/\/rest\/v1\/([a-z_]+)/);
      if (!m) return;
      const cur = calls.get(m[1]) || { calls: 0, bytes: 0 };
      cur.calls += 1;
      cur.bytes += Number(res.headers()['content-length'] || 0);
      calls.set(m[1], cur);
    });
    const sum = () => [...calls.values()].reduce((s, v) => s + v.calls, 0);
    await loginAsCashier(page);

    // Máy B: ghi dữ liệu mới
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const name = 'KH realtime ' + Date.now().toString().slice(-6);
    const phone = '09' + Date.now().toString().slice(-8);
    await loginAsCashier(pageB);
    await pageB.click('#btn-quick-customer-modal');
    await pageB.fill('#quick-cust-name', name);
    await pageB.fill('#quick-cust-phone', phone);
    await pageB.click('#btn-confirm-save-quick-customer');
    await expect(pageB.locator('[role="dialog"]')).toHaveCount(0, { timeout: 15_000 });

    // Máy A phải thấy khách mới NHANH qua realtime — nhanh hơn nhiều so với nhịp 120s
    const t0 = Date.now();
    await expect(async () => {
      await page.fill('#f4-customer-input', name);
      await expect(page.locator('#customer-search-dropdown')).toContainText(name, { timeout: 4000 });
    }).toPass({ timeout: 30_000 });
    const realtimeMs = Date.now() - t0;
    console.log('REALTIME_FRESHNESS_MS=' + realtimeMs);
    expect(realtimeMs).toBeLessThan(15_000);

    // Lưu lượng 60s đứng yên (bỏ qua phần vừa hydrate)
    await page.fill('#f4-customer-input', '');
    await page.waitForTimeout(20_000);
    calls.clear();
    await page.waitForTimeout(60_000);
    const idleCalls = sum();
    console.log('IDLE_60S_CALLS=' + idleCalls);
    // Trước đổi: 32 request / 60s. Nay chỉ còn lưới an toàn 120s + refresh lúc bật realtime.
    expect(idleCalls).toBeLessThan(14);

    // Quay lại tab phải đồng bộ ngay. Lưu ý: headless KHÔNG bắn focus/visibilitychange
    // khi đổi tab (đã probe: 0 sự kiện), nên test bắn sự kiện để kiểm tra phần nối
    // listener -> refresh; hành vi thật của trình duyệt là listener có sẵn từ trước.
    calls.clear();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(8000);
    const focusCalls = sum();
    console.log('FOCUS_REFRESH_CALLS=' + focusCalls);
    expect(focusCalls).toBeGreaterThan(0);

    // Dọn: xoá khách test trên máy B (bảng desktop; #customer-record-list chỉ hiện ở mobile)
    await pageB.keyboard.press('Alt+m');
    await pageB.locator('#menu-item-customers').click();
    await expect(pageB.locator('#customers-view')).toBeVisible({ timeout: 15_000 });
    await pageB.locator('#customers-view input[placeholder="Tìm theo Tên, SĐT, Mã KH..."]').fill(name);
    const row = pageB.locator('#customers-view tbody tr', { hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await pageB.locator('#customers-view button[title="Xóa khách hàng"]').first().click();
    const dialog = pageB.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /Xóa/ }).last().click();
    await expect(pageB.locator('#customers-view tbody tr', { hasText: name })).toHaveCount(0, { timeout: 15_000 });
    await ctxB.close();
  });
});
