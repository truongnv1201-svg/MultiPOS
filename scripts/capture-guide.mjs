import { chromium } from '@playwright/test';
import fs from 'node:fs';
(async () => {
  fs.mkdirSync('public/guide', { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('console', m => { if (m.type() === 'error') console.log('[console-err]', m.text().slice(0,200)); });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'public/guide/01-dang-nhap.png' });
  console.log('shot 01 login, url=', page.url());
  // Try login as admin
  try {
    const idInput = page.locator('#login-id-input');
    if (await idInput.count()) {
      await idInput.fill('admin@multipos.local');
      await page.locator('#login-password-input').fill('Admin@123');
      await page.locator('#btn-login-submit').click();
      await page.waitForTimeout(5000);
      console.log('after login attempt, loginOpen count=', await page.locator('#login-modal-overlay').count());
    }
  } catch (e) { console.log('login err', e.message); }
  await page.screenshot({ path: 'public/guide/02-man-hinh-ban-hang-pos.png' });

  // Open flyout menu
  try {
    const trigger = page.locator('#flyout-menu-trigger');
    if (await trigger.count()) { await trigger.click(); await page.waitForTimeout(800); }
    await page.screenshot({ path: 'public/guide/03-menu-dieu-huong.png' });
    // close menu with Esc
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  } catch (e) { console.log('menu err', e.message); }

  const screens = ['orders','products','inventory','customers','suppliers','projects','hr','cashbook','reports','settings'];
  const names = {
    orders: '04-hoa-don', products: '05-hang-hoa', inventory: '06-kho-hang',
    customers: '07-khach-hang', suppliers: '08-nha-cung-cap', projects: '09-cong-trinh',
    hr: '10-nhan-su', cashbook: '11-so-quy', reports: '12-bao-cao', settings: '13-cai-dat'
  };
  for (const s of screens) {
    try {
      await page.evaluate((scr) => {
        try { localStorage.setItem('multipos_last_screen', JSON.stringify(scr)); } catch {}
        // also try plain
        try { localStorage.setItem('multipos_last_screen', scr); } catch {}
      }, s);
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2500);
      // dismiss login modal if reappeared? keep session
      await page.screenshot({ path: `public/guide/${names[s]}.png` });
      console.log('shot', s);
    } catch (e) { console.log('shot err', s, e.message); }
  }
  // F12 shift modal + F3 note: try open shift via button if logged in
  try {
    await page.evaluate(() => { try { localStorage.setItem('multipos_last_screen', 'pos'); } catch {} });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
    const shiftBtn = page.locator('#header-shift-btn');
    if (await shiftBtn.count()) { await shiftBtn.click(); await page.waitForTimeout(800); await page.screenshot({ path: 'public/guide/14-mo-ca-dong-ca-f12.png' }); await page.keyboard.press('Escape'); }
  } catch (e) { console.log('shift err', e.message); }
  await browser.close();
  console.log('DONE');
})();
