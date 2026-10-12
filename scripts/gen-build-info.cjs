// Sinh public/build-info.json (ngay build + SHA commit) cho chip version CalVer tu dong.
// Goi tu next.config.ts MỖI lần build/dev (khong phu thuoc Build Command cua host).
// Best-effort: that bai thi ghi fallback 'dev', KHONG bao gio chan build.
const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

function shortSha() {
  const env = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  if (env) return env.slice(0, 7);
  try {
    const out = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (out) return out.slice(0, 7);
  } catch {
    /* khong co git (build tarball) -> fallback */
  }
  return 'dev';
}

function buildDate() {
  try {
    // Ngay build theo gio VN, dang YY.MM.DD (CalVer gon nhe).
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => {
      const p = parts.find((x) => x.type === t);
      return (p && p.value) || '00';
    };
    return `${get('year')}.${get('month')}.${get('day')}`;
  } catch {
    return 'dev';
  }
}

function genBuildInfo(root) {
  const info = { date: buildDate(), sha: shortSha() };
  try {
    const base = root || process.cwd();
    mkdirSync(join(base, 'public'), { recursive: true });
    writeFileSync(join(base, 'public', 'build-info.json'), JSON.stringify(info));
  } catch {
    /* khong ghi duoc van build tiep, route tra fallback */
  }
  return info;
}

module.exports = { genBuildInfo, shortSha, buildDate };

if (require.main === module) {
  const info = genBuildInfo();
  console.log(`build-info: ${info.date} ${info.sha}`);
}
