import type {NextConfig} from 'next';

// Chip version CalVer tu dong: ghi public/build-info.json (ngay + SHA) moi lan
// nap config (mọi Build Command đều qua đây). Best-effort, không chặn build.
try {
  const { genBuildInfo } = require('./scripts/gen-build-info.cjs');
  genBuildInfo();
} catch {
  /* route /api/version tu tra fallback */
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // P2: lint chặn build (0 errors; warnings cho phép). Đừng bật lại ignore trừ khi khẩn.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: 'standalone',
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
