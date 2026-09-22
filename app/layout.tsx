import type {Metadata, Viewport} from 'next';
import './globals.css'; // Global styles
import {PwaRegister} from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'MultiPOS - Quản trị Bán hàng & Thi công Đa ngành',
  description: 'Hệ thống quản lý bán hàng POS đa ngành, đo đạc kích thước m2, quản lý kho vật tư thi công và công nợ chuẩn KiotViet v2.12',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MultiPOS',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
  openGraph: {
    title: 'MultiPOS - Quản trị Bán hàng & Thi công Đa ngành',
    description: 'Hệ thống quản lý bán hàng POS đa ngành, đo đạc kích thước m2, quản lý kho vật tư thi công và công nợ chuẩn KiotViet v2.12',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MultiPOS - Quản trị Bán hàng & Thi công Đa ngành',
    description: 'Hệ thống quản lý bán hàng POS đa ngành, đo đạc kích thước m2, quản lý kho vật tư thi công và công nợ chuẩn KiotViet v2.12',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="vi">
      <body suppressHydrationWarning>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
