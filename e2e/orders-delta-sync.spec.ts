import { test, expect, type Page } from '@playwright/test';

// Kéo delta đơn hàng theo updated_at (lib/store/tx/orders-sync.ts).
// Hai điều kiện phải đúng đồng thời:
//   1) Đúng dữ liệu: một đơn ĐÃ CÓ trên máy A rồi bị máy B đổi trạng thái (hủy) thì máy A
//      phải thấy, không reload. Đây là chỗ hỏng nếu ai đó hợp nhất kiểu "chỉ nối thêm" hoặc
//      đổi watermark sang created_at.
//   2) Nhẹ lưu lượng: máy A nhận 1 lần bán từ máy B chỉ kéo phần thay đổi (~1 KB) thay vì
//      kéo lại cửa sổ 90 ngày (trước đây ~178 KB cho orders + order_items).
//
// Có thể ép mã đơn cũ qua DELTA_TARGET_CODE (ví dụ HD-TEST-OLD-0001) để kiểm đúng trường
// hợp mà watermark created_at chắc chắn bỏ sót; mặc định test tự tạo đơn của riêng nó.
const LOGIN_ID = process.env.E2E_LOGIN_ID || 'cashier@multipos.local';
const LOGIN_PW = process.env.E2E_LOGIN_PASSWORD || 'Cashier@123';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', LOGIN_ID);
  await page.fill('#login-password-input', LOGIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#header-sync-center-btn')).toHaveAttribute('title', /trực tiếp/i, { timeout: 30_000 });
}

async function addAnyGoods(page: Page) {
  const search = page.locator('#f1-search-input');
  for (const term of ['a', 'e', 'o']) {
    await search.fill(term);
    // Bỏ qua mặt hàng hết tồn (server chặn bán khi tồn âm -> pos_checkout 400).
    const items = page.locator('#search-results-dropdown div[id^="search-item-"]').filter({ hasNotText: /Tồn:\s*0(?!\d)/ });
    if ((await items.count().catch(() => 0)) === 0) continue;
    await items.first().click();
    if (await page.locator('#dimension-modal-overlay').isVisible().catch(() => false)) {
      await page.locator('#btn-close-dimension-modal').click();
      continue;
    }
    if ((await page.locator('#cart-table-container tbody tr').count()) > 0) return;
  }
  throw new Error('không thêm được mặt hàng nào vào giỏ');
}

/** Bán 1 món tiền mặt, trả về mã đơn. */
async function sellOne(page: Page): Promise<string> {
  await addAnyGoods(page);
  const payable = Number((await page.locator('#payable-total-display').innerText()).replace(/[^\d]/g, '')) || 0;
  expect(payable).toBeGreaterThan(0);
  await page.locator('#payment-method-cash').click();
  await page.locator('#f9-tendered-input').fill(String(payable + 100000));
  await page.locator('#btn-pos-checkout').click();
  await expect(page.locator('#receipt-modal-overlay')).toBeVisible({ timeout: 30_000 });
  const code = (await page.locator('#receipt-modal-container h3').innerText()).match(/HD-\d+-\d+/)?.[0];
  await page.locator('#receipt-modal-container button', { hasText: 'Đóng' }).first().click();
  await expect(page.locator('#receipt-modal-overlay')).toBeHidden({ timeout: 10_000 });
  return code!;
}

async function cancelOrder(page: Page, code: string) {
  await page.keyboard.press('Alt+m');
  await page.locator('#menu-item-orders').click();
  await expect(page.locator('#orders-view')).toBeVisible({ timeout: 15_000 });
  await page.locator('#orders-view input[placeholder="Mã đơn, tên khách, SĐT..."]').fill(code);
  const row = page.locator('#orders-view tbody tr', { hasText: code }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.locator('#orders-view button', { hasText: 'Hủy hóa đơn & Hoàn quỹ' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  await dlg.getByRole('button', { name: /Hủy đơn/ }).click();
  await expect(dlg).toHaveCount(0, { timeout: 20_000 });
}

test('delta đơn hàng: đổi trạng thái đơn cũ về nhanh + 1 lần bán không kéo lại cả bảng', async ({ page, browser }) => {
  test.slow();
  const bytes = new Map<string, number>();
  page.on('response', async (res) => {
    const m = res.url().match(/\/rest\/v1\/([a-z_]+)/);
    if (!m) return;
    let len = Number(res.headers()['content-length'] || 0);
    if (!len) {
      try {
        len = (await res.body()).length;
      } catch {
        len = 0;
      }
    }
    bytes.set(m[1], (bytes.get(m[1]) || 0) + len);
  });
  const kb = (t: string) => Math.round((bytes.get(t) || 0) / 1024);

  // Máy A: máy thu ngân "đứng yên", chỉ nhận
  await login(page);
  await page.waitForTimeout(12_000);

  // Máy B: máy thứ hai bán hàng
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await login(pageB);
  const forcedCode = process.env.DELTA_TARGET_CODE;
  let code = forcedCode || '';
  if (!forcedCode) {
    bytes.clear();
    code = await sellOne(pageB);
    await page.waitForTimeout(25_000);
    const ordersKB = kb('orders');
    const itemsKB = kb('order_items');
    const totalKB = Math.round([...bytes.values()].reduce((s, v) => s + v, 0) / 1024);
    console.log(`PER_SALE_KB total=${totalKB} orders=${ordersKB} order_items=${itemsKB}`);
    // Trước đây orders ~76 KB + order_items ~102 KB; delta chỉ vài KB.
    expect(ordersKB).toBeLessThan(20);
    expect(itemsKB).toBeLessThan(20);
  }

  // Máy A phải thấy đơn đó (nếu là đơn do B vừa bán thì đây cũng là bằng chứng delta
  // có đưa đơn MỚI sang máy khác).
  await page.keyboard.press('Alt+m');
  await page.locator('#menu-item-orders').click();
  await expect(page.locator('#orders-view')).toBeVisible({ timeout: 15_000 });
  await page.locator('#orders-view select:has(option[value="today"])').first().selectOption('all');
  await page.locator('#orders-view input[placeholder="Mã đơn, tên khách, SĐT..."]').fill(code);
  const rowA = page.locator('#orders-view tbody tr', { hasText: code }).first();
  await expect(rowA).toBeVisible({ timeout: 20_000 });
  await expect(rowA).not.toContainText('Đã hủy');

  // Máy B hủy đơn đó
  await cancelOrder(pageB, code);

  // Máy A phải thấy trạng thái mới mà không reload
  const t0 = Date.now();
  await expect(rowA).toContainText('Đã hủy', { timeout: 20_000 });
  const updateMs = Date.now() - t0;
  console.log('ORDER_UPDATE_MS=' + updateMs + ' code=' + code);
  expect(updateMs).toBeLessThan(20_000);
  await ctxB.close();
});
