// VietQR cấu hình thương mại: QR ảnh qua img.vietqr.io (không cần API key).
// Cần: mã ngân hàng + số tài khoản + tên chủ TK (nhập ở Cài đặt).

export interface VietqrConfig {
  bank: string; // slug VietQR: MB, VCB, TCB, ...
  account: string; // số tài khoản, chỉ số
  name: string; // tên chủ TK (không dấu khi lên QR)
}

export const VIETQR_BANKS: { code: string; name: string }[] = [
  { code: 'MB', name: 'MBBank' },
  { code: 'VCB', name: 'Vietcombank' },
  { code: 'TCB', name: 'Techcombank' },
  { code: 'ACB', name: 'ACB' },
  { code: 'BIDV', name: 'BIDV' },
  { code: 'VPB', name: 'VPBank' },
  { code: 'TPB', name: 'TPBank' },
  { code: 'STB', name: 'Sacombank' },
  { code: 'HDB', name: 'HDBank' },
  { code: 'SHB', name: 'SHB' },
  { code: 'MSB', name: 'MSB' },
  { code: 'OCB', name: 'OCB' },
];

export function isVietqrReady(v: VietqrConfig | null | undefined): v is VietqrConfig {
  return !!v && !!v.bank && /^\d{6,19}$/.test(v.account || '');
}

// Chuẩn hóa nội dung CK: không dấu, alphanum + space, tối đa 25 ký tự
export function vietqrAddInfo(raw: string): string {
  const noAccent = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return noAccent.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 25).trim() || 'THANHTOAN';
}

export function buildVietqrUrl(cfg: VietqrConfig, amount?: number, addInfo?: string): string {
  const info = encodeURIComponent(vietqrAddInfo(addInfo || 'THANHTOAN'));
  const accName = encodeURIComponent(vietqrAddInfo(cfg.name || ''));
  const amt = amount === undefined ? '' : `&amount=${Math.max(0, Math.round(amount))}`;
  return `https://img.vietqr.io/image/${cfg.bank}-${cfg.account}-compact2.png?accountName=${accName}${amt}&addInfo=${info}`;
}
