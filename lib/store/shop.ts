// P3: cấu hình cửa hàng + mẫu in (tách từ lib/store.tsx — re-export ở đó để giữ import cũ).

export type PrinterWidth = '80mm' | 'A4' | 'A5';
export type PrintTemplate = 'k80-full' | 'a4-invoice' | 'a5-invoice';
/** Mẫu cũ đã bỏ (giữ để migrate localStorage máy trạm cũ về mẫu mới). */
export type LegacyPrintTemplate = PrintTemplate | 'k80-compact' | 'k58-mini' | 'a4-quote';
export type ReceiptFontSize = 'small' | 'medium' | 'large';

export interface ShopSettings {
  name: string;
  hotline: string;
  address: string;
  taxCode: string;
  email: string;
  footerThanks: string;
  receiptPolicy: string;
  printerWidth: PrinterWidth;
  printTemplate: PrintTemplate;
  printCopies: number;
  autoPrint: boolean;
  showLogo: boolean;
  showCashier: boolean;
  showCustomerPhone: boolean;
  showVietqr: boolean;
  showDimensions: boolean;
  showDebt: boolean;
  fontSize: ReceiptFontSize;
  defaultVat: 0 | 8 | 10;
  defaultPayment: 'cash' | 'transfer' | 'card' | 'debt';
  defaultPriceBook: 'retail' | 'trade';
  otMultiplierWorkday?: number;
  otMultiplierWeekend?: number;
}

export interface GrindingService {
  id: string;
  label: string;
  price_per_md: number;
}

export const DEFAULT_SHOP: ShopSettings = {
  name: 'Nội Thất & Nhôm Kính Đa Ngành',
  hotline: '0901.234.567',
  address: '142 Lý Thường Kiệt, P.7, Q.10, TP.HCM',
  taxCode: '',
  email: '',
  footerThanks: 'Cảm ơn Quý khách & Hẹn gặp lại!',
  receiptPolicy: 'Hàng mua quy cách kính & tấm cắt không nhận đổi trả sau khi xuất xưởng.',
  printerWidth: '80mm',
  printTemplate: 'k80-full',
  printCopies: 1,
  autoPrint: true,
  showLogo: true,
  showCashier: true,
  showCustomerPhone: true,
  showVietqr: true,
  showDimensions: true,
  showDebt: true,
  fontSize: 'medium',
  defaultVat: 0,
  defaultPayment: 'cash',
  defaultPriceBook: 'retail',
  otMultiplierWorkday: 1.5,
  otMultiplierWeekend: 2.0,
};

export const PRINT_TEMPLATES: { id: PrintTemplate; label: string; desc: string; paper: string }[] = [
  { id: 'k80-full', label: 'K80 đầy đủ', desc: 'Máy nhiệt quầy: đủ logo, QR, quy cách tấm, công nợ', paper: '80mm' },
  { id: 'a4-invoice', label: 'A4 hóa đơn', desc: 'Cho thợ/công trình: bảng kê, VAT, ký tên 2 bên', paper: 'A4' },
  { id: 'a5-invoice', label: 'A5 hóa đơn (ngang)', desc: 'Gọn nửa tờ A4, in ngang: đủ bảng kê + QR, tiết kiệm giấy', paper: 'A5' },
];

/** Chuẩn hóa mẫu in đọc từ localStorage (máy cũ có thể còn k80-compact / k58-mini / a4-quote). */
export function normalizePrintTemplate(t: unknown): PrintTemplate {
  if (t === 'a4-invoice' || t === 'a5-invoice' || t === 'k80-full') return t;
  if (t === 'a4-quote') return 'a4-invoice';
  return 'k80-full';
}

/** Chuẩn hóa khổ giấy đọc từ localStorage (đã bỏ K58). */
export function normalizePrinterWidth(w: unknown): PrinterWidth {
  if (w === 'A4' || w === 'A5' || w === '80mm') return w;
  return '80mm';
}
