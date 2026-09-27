import { test, expect, type Page } from '@playwright/test';

// Regression: mirror cache Dexie từng dùng clear() + bulkAdd(bản chụp server).
// Nếu người dùng lưu một mặt hàng NGAY LÚC server đang trả về, bản ghi đó không có trong
// bản chụp nên bị xoá khỏi cache. Với bản ghi đã lên server thì lần pull sau chữa lại được,
// nhưng với bản ghi CHƯA lên server (ghi offline, đang chờ trong hàng đợi) thì mất hẳn.
//
// Cách tái hiện: chặn response của products trong ~12s để tạo ra khoảng trống giữa lúc
// app chụp bản và lúc ghi cache; trong khoảng đó tạo một mặt hàng qua UI; rồi đọc thẳng
// IndexedDB để xem bản ghi còn trong cache hay không (UI có thể tự chữa ở lần pull kế).
const ADMIN_ID = process.env.E2E_ADMIN_LOGIN_ID || 'admin@multipos.local';
const ADMIN_PW = process.env.E2E_ADMIN_LOGIN_PASSWORD || 'Admin@123';
const DB_NAME = 'MultiPOSDB_v213';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-modal-overlay')).toBeVisible();
  await page.fill('#login-id-input', ADMIN_ID);
  await page.fill('#login-password-input', ADMIN_PW);
  await page.click('#btn-login-submit');
  await expect(page.locator('#pos-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#network-status-toggle')).toContainText('Trực tiếp', { timeout: 30_000 });
  await page.waitForTimeout(12_000);
}

/** Đếm số mặt hàng trong cache Dexie (đọc thẳng IndexedDB, không qua React). */
function cachedProducts(page: Page) {
  return page.evaluate(
    (dbName) =>
      new Promise<{ count: number; skus: string[] }>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(new Error('không mở được IndexedDB'));
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('products')) {
            resolve({ count: 0, skus: [] });
            return;
          }
          const tx = db.transaction('products', 'readonly');
          const all = tx.objectStore('products').getAll();
          all.onsuccess = () => {
            const rows = (all.result || []) as Array<{ sku?: string }>;
            resolve({ count: rows.length, skus: rows.map((r) => String(r.sku || '')) });
          };
          all.onerror = () => reject(new Error('đọc store products lỗi'));
        };
      }),
    DB_NAME
  );
}

/** Số bản ghi master data đang chờ đẩy (0 = mọi thứ đã lên server xong). */
function pendingMasterCount(page: Page) {
  return page.evaluate(
    (dbName) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(new Error('không mở được IndexedDB'));
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('pendingMasterData')) {
            resolve(0);
            return;
          }
          const tx = db.transaction('pendingMasterData', 'readonly');
          const all = tx.objectStore('pendingMasterData').getAll();
          all.onsuccess = () => resolve((all.result || []).length);
          all.onerror = () => reject(new Error('đọc pendingMasterData lỗi'));
        };
      }),
    DB_NAME
  );
}

test('mặt hàng tạo trong lúc server đang trả về không bị xoá khỏi cache Dexie', async ({ page }) => {
  test.slow(); // có delay cố ý 20s
  await login(page);

  const sku = 'RACE' + Date.now().toString().slice(-6);
  try {
    // Chặn GET products để tạo khoảng trống giữa lúc app chụp bản và lúc ghi cache.
    // - GET đầu tiên: chụp dữ liệu ngay rồi trả ra sau 20s (xem chú thích bên dưới).
    // - GET sau đó: giữ lại, không trả lời, để không có lần pull nào "chữa" lại cache.
    //   Nếu không thì lần kéo kế tiếp sẽ lấy lại mặt hàng từ server và che mất lỗi.
    // Chỉ GET: POST tạo mặt hàng phải đi qua ngay.
    let getCount = 0;
    const handler = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      getCount += 1;
      if (getCount === 1) {
        // QUAN TRỌNG: phải chụp dữ liệu NGAY (route.fetch() chạy truy vấn thật), rồi mới
        // trả ra sau. Nếu chỉ trì hoãn rồi route.continue() thì truy vấn chỉ chạy sau khi
        // trễ -> sản phẩm tạo trong lúc chờ đã nằm trong snapshot -> lỗi không xảy ra.
        const response = await route.fetch();
        const body = await response.body();
        await new Promise((r) => setTimeout(r, 20_000));
        await route.fulfill({ response, body });
        return;
      }
      await new Promise(() => {});
    };
    await page.route('**/rest/v1/products*', handler);
    await page.route('**/rest/v1/catalog_public*', handler);

    // Kích hoạt một lần kéo catalog (poll dự phòng lắng nghe focus)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1500);

    // Trong lúc chờ: tạo mặt hàng mới qua UI
    await page.keyboard.press('Alt+m');
    await page.locator('#menu-item-products').click();
    await expect(page.locator('#products-view')).toBeVisible({ timeout: 20_000 });

    const posted = page.waitForResponse(
      (r) => r.url().includes('/rest/v1/products') && r.request().method() === 'POST' && r.ok(),
      { timeout: 30_000 }
    );
    await page.click('#btn-open-add-product-modal');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });
    await page.fill('#add-product-name-input', 'Test race ' + sku);
    await page.fill('#add-product-sku-input', sku);
    // Giá > 0: nếu test chết giữa chừng và để lại mặt hàng giá 0, các test bán hàng khác
    // có thể chọn trúng nó rồi không checkout được (tổng = 0).
    await page.fill('#add-product-price-input', '10000');
    await page.click('#btn-add-product-save');
    await posted;
    await expect(page.locator('#products-view')).toContainText(sku, { timeout: 30_000 });
    console.log('CREATED_SKU=' + sku);

    // Tiền đề của lỗi: mặt hàng đã lên server và đã hết hàng đợi cục bộ. Nếu còn pending
    // thì lỗi không xảy ra dù code cũ hay mới, và test sẽ xanh giả.
    await expect.poll(() => pendingMasterCount(page), { timeout: 20_000 }).toBe(0);
    const beforeMirror = await cachedProducts(page);
    console.log('TRUOC_MIRROR co_sku=' + beforeMirror.skus.includes(sku) + ' count=' + beforeMirror.count);
    expect(beforeMirror.skus.includes(sku)).toBe(true);

    // Chờ lần mirror đầu tiên commit xong (snapshot đã chụp, trả ra sau 20s)
    await page.waitForTimeout(24_000);

    const cache = await cachedProducts(page);
    console.log('SAU_MIRROR co_sku=' + cache.skus.includes(sku) + ' count=' + cache.count + ' get_count=' + getCount);
    expect(
      cache.skus.includes(sku),
      'bản ghi đã lên server, tạo trong lúc kéo server, không được xoá khỏi cache Dexie'
    ).toBe(true);
  } finally {
    // Dọn luôn khi test fail, và bỏ chặn route trước khi xoá (nếu không sẽ treo request).
    await page.unroute('**/rest/v1/products*').catch(() => {});
    await page.unroute('**/rest/v1/catalog_public*').catch(() => {});
    await page.locator('#products-view input[placeholder*="Tìm"]').first().fill(sku).catch(() => {});
    await page.waitForTimeout(1500).catch(() => {});
    const row = page.locator('#products-view tbody tr', { hasText: sku }).first();
    if ((await row.count().catch(() => 0)) > 0) {
      await row.locator('button[title*="Xóa"], button[aria-label*="Xóa"]').first().click().catch(() => {});
      const dlg = page.getByRole('alertdialog');
      if ((await dlg.count().catch(() => 0)) > 0) await dlg.getByRole('button').last().click().catch(() => {});
      await page.waitForTimeout(2000).catch(() => {});
    }
  }
});
