// Sinh icon PNG cho PWA từ file SVG trong public/icons (không thêm dependency ảnh).
// Dùng Chromium của Playwright sẵn có trong devDependencies.
// Chạy: npm run icons:pwa   (chạy lại sau khi đổi SVG)
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'public', 'icons');

const TARGETS = [
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
];

if (!existsSync(ICON_DIR)) mkdirSync(ICON_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  for (const target of TARGETS) {
    const svg = readFileSync(join(ICON_DIR, target.svg), 'utf8');
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:transparent}
        svg{display:block;width:${target.size}px;height:${target.size}px}
      </style></head><body>${svg}</body></html>`,
      { waitUntil: 'load' }
    );
    await page.screenshot({
      path: join(ICON_DIR, target.png),
      omitBackground: true,
      clip: { x: 0, y: 0, width: target.size, height: target.size },
    });
    await page.close();
    console.log(`✓ ${target.png} (${target.size}x${target.size})`);
  }
} finally {
  await browser.close();
}
