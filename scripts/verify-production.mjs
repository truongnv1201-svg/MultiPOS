#!/usr/bin/env node
// Verify production deployment sau khi config Vercel + Supabase
// Chạy: node scripts/verify-production.mjs https://your-domain.vercel.app

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2];
if (!URL || !URL.startsWith('http')) {
  console.error('Usage: node scripts/verify-production.mjs https://your-domain.vercel.app');
  process.exit(1);
}

const BASE = URL.replace(/\/+$/, '');

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, redirect: 'follow' });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, headers: Object.fromEntries(res.headers) };
}

console.log(`\n🔍 Verifying production: ${BASE}\n`);

const checks = [];

// 1. Homepage loads
const home = await fetchJson('/');
checks.push({ name: 'Homepage 200', pass: home.ok, detail: home.ok ? '' : `HTTP ${home.status}` });

// 2. Service Worker accessible
const sw = await fetchJson('/sw.js');
checks.push({ name: 'sw.js 200 + no-cache', pass: sw.ok && /must-revalidate|no-cache/i.test(sw.headers['cache-control'] || ''), detail: sw.ok ? `Cache-Control: ${sw.headers['cache-control']}` : `HTTP ${sw.status}` });

// 3. Manifest
const manifest = await fetchJson('/manifest.webmanifest');
checks.push({ name: 'manifest.webmanifest 200', pass: manifest.ok, detail: manifest.ok ? '' : `HTTP ${manifest.status}` });

// 4. Offline page
const offline = await fetchJson('/offline');
checks.push({ name: '/offline 200', pass: offline.ok, detail: offline.ok ? '' : `HTTP ${offline.status}` });

// 5. API admin (should 401/403 without auth, not 404)
const apiCreate = await fetchJson('/api/admin/create-user', { method: 'POST' });
checks.push({ name: 'API admin route exists', pass: apiCreate.status !== 404, detail: `HTTP ${apiCreate.status}` });

// 6. No console errors in HTML (basic check)
const hasError = /console\.error|alert\(|throw new Error/.test(home.text);
checks.push({ name: 'No obvious client errors in HTML', pass: !hasError, detail: hasError ? 'Found error patterns' : '' });

// 7. Supabase config check (client bundle contains anon key)
const hasAnonKey = /NEXT_PUBLIC_SUPABASE_URL|supabase\.co/.test(home.text);
checks.push({ name: 'Supabase config injected', pass: hasAnonKey, detail: hasAnonKey ? '' : 'Anon key not found in bundle' });

// 8. PWA meta tags
const hasManifestLink = /manifest\.webmanifest/.test(home.text);
const hasAppleCapable = /apple-mobile-web-app-capable/.test(home.text);
checks.push({ name: 'PWA meta tags present', pass: hasManifestLink && hasAppleCapable, detail: `manifest: ${hasManifestLink}, apple: ${hasAppleCapable}` });

// Summary
console.log('┌─────────────────────────────────────────────────────────────┐');
checks.forEach((c, i) => {
  const icon = c.pass ? '✅' : '❌';
  console.log(`│ ${icon} ${String(i + 1).padStart(2, ' ')}. ${c.name.padEnd(40)} ${c.pass ? 'OK' : 'FAIL'}`);
  if (!c.pass) console.log(`│     └─ ${c.detail}`);
});
console.log('└─────────────────────────────────────────────────────────────┘');

const failed = checks.filter(c => !c.pass).length;
console.log(`\n📊 Result: ${checks.length - failed}/${checks.length} passed`);
if (failed > 0) {
  console.log('⚠️  Có lỗi — kiểm tra Vercel Logs / Supabase Auth URLs / DNS');
  process.exit(1);
} else {
  console.log('🎉 Production deployment OK — sẵn sàng 2 máy');
  process.exit(0);
}