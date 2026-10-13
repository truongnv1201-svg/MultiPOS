'use client';

import QRCode from 'react-qr-code';
import { buildVietqrPayload, type VietqrConfig } from '@/lib/vietqr';

interface VietqrCodeProps {
  config: VietqrConfig;
  amount?: number;
  addInfo?: string;
  className?: string;
  title?: string;
}

/**
 * Mã QR VietQR phong cách riêng của shop: QR sạch (màu mực slate-900 trên
 * trắng, không logo/khung/chữ VietQR), vẽ tại máy bằng react-qr-code nên
 * in ấn không cần mạng. Trả null (không vẽ QR giả) khi cấu hình thiếu/sai.
 */
export function VietqrCode({ config, amount, addInfo, className, title }: VietqrCodeProps) {
  const payload = buildVietqrPayload(config, amount, addInfo);
  if (!payload) return null;
  return (
    <QRCode
      value={payload}
      size={256}
      level="M"
      bgColor="#FFFFFF"
      fgColor="#0F172A"
      className={className}
      title={title ?? 'Quét để chuyển khoản đúng số tiền'}
    />
  );
}
