// VietQR phong cách riêng của shop: dựng chuỗi payload EMVCo và vẽ QR sạch
// (SVG, không logo/khung/chú thích VietQR) bằng react-qr-code.
// Lợi thêm: QR sinh offline tại máy — in ấn không phụ thuộc mạng img.vietqr.io.
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

// --- Payload EMVCo VietQR (chuẩn Napas) để tự vẽ QR ---

// Mã BIN Napas của các ngân hàng trong VIETQR_BANKS (chuẩn công khai).
export const VIETQR_BANK_BINS: Record<string, string> = {
  MB: '970422',
  VCB: '970436',
  TCB: '970407',
  ACB: '970416',
  BIDV: '970418',
  VPB: '970432',
  TPB: '970423',
  STB: '970403',
  HDB: '970437',
  SHB: '970443',
  MSB: '970426',
  OCB: '970448',
};

function emvField(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

// CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) — vector chuẩn "123456789" -> 0x29B1.
export function crc16ccitt(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * Dựng chuỗi payload VietQR từ cấu hình shop — byte-identical với payload
 * img.vietqr.io sinh (đã giải mã QR thật và đối chiếu từng field).
 * - 00=01, 01=12 (động, kèm số tiền), 38 Napas (BIN + STK + tag dịch vụ
 *   QRIBFTTA), 53=704, 54 khi có số tiền, 58=VN, 62 nội dung CK (≤25 ký tự),
 *   63 CRC. KHÔNG có 52/59/60 như bản chuẩn (thêm vào là app báo sai định dạng).
 * - Trả null khi ngân hàng lạ (ngoài VIETQR_BANKS) — UI không vẽ QR giả.
 */
export function buildVietqrPayload(cfg: VietqrConfig, amount?: number, addInfo?: string): string | null {
  const bin = VIETQR_BANK_BINS[(cfg.bank || '').toUpperCase()];
  const account = (cfg.account || '').trim();
  if (!bin || !/^\d{6,19}$/.test(account)) return null;
  const acctInfo = emvField('00', bin) + emvField('01', account);
  const napas = emvField('00', 'A000000727') + emvField('01', acctInfo) + emvField('02', 'QRIBFTTA');
  let payload =
    emvField('00', '01') +
    emvField('01', '12') +
    emvField('38', napas) +
    emvField('53', '704');
  if (amount !== undefined) payload += emvField('54', String(Math.max(0, Math.round(amount))));
  payload += emvField('58', 'VN');
  payload += emvField('62', emvField('08', vietqrAddInfo(addInfo || 'THANHTOAN')));
  const crc = crc16ccitt(payload + '6304')
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `${payload}6304${crc}`;
}
