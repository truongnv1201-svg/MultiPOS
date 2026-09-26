'use client';

import React, { useEffect, useState } from 'react';
import { useStore, PRINT_TEMPLATES, normalizePrintTemplate } from '@/lib/store';
import type { PrintTemplate } from '@/lib/store';
import { formatVND, formatNumber } from '@/lib/format';
import { formatQty } from '@/lib/quantity';
import { isVietqrReady, buildVietqrUrl } from '@/lib/vietqr';
import { printElementInTab } from '@/lib/print';
import { notify } from '@/components/common/Toast';
import { Printer, X, QrCode, Receipt, Share2 } from 'lucide-react';

export function ReceiptModal() {
  const { receiptModalOrder, setReceiptModalOrder, shop, updateShop, vietqr } = useStore();
  const [template, setTemplate] = useState<PrintTemplate>('k80-full');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (receiptModalOrder) setTemplate(normalizePrintTemplate(shop.printTemplate) || 'k80-full');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptModalOrder?.id]);

  if (!receiptModalOrder) return null;
  const order = receiptModalOrder;
  const isDeposit = order.status === 'deposit_order';
  const paidByTransfer = order.payments?.some((p) => p.method === 'transfer');
  const showVietqrBlock = !!shop.showVietqr && isVietqrReady(vietqr) && (paidByTransfer || order.debt_amount > 0);

  const fontCls =
    shop.fontSize === 'small' ? 'text-[10px]' : shop.fontSize === 'large' ? 'text-[12px]' : 'text-[11px]';
  // Cỡ chữ phiếu (K80/giấy nhiệt): các khối con gắn cỡ cứng nên chỉ đổi font gốc
  // không đủ — dùng zoom để cả phiếu co/giãn thật (Chromium in ấn vẫn giữ zoom).
  // A4/A5 giữ layout cố định theo chuẩn văn phòng.
  const k80Zoom = shop.fontSize === 'small' ? 0.9 : shop.fontSize === 'large' ? 1.12 : 1;

  const handlePrint = () => {
    const prevTitle = document.title;
    document.title = '';
    const cleanup = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  // Điện thoại: kéo #print-area + CSS app ra tab in riêng (chọn máy in nhiệt / Lưu PDF).
  const handlePrintMobile = () => {
    const area = document.getElementById('print-area');
    if (!area) {
      notify('Chưa có nội dung phiếu để in.', 'error');
      return;
    }
    const ok = printElementInTab(area, `Phiếu ${order.order_code}`, pageCss);
    if (!ok) {
      notify('Trình duyệt chặn mở tab in — cho phép popup rồi bấm lại, hoặc dùng nút In thường.', 'error');
    }
  };
  const handlePickTemplate = (t: PrintTemplate) => {
    setTemplate(t);
    const found = PRINT_TEMPLATES.find((x) => x.id === t);
    if (found) updateShop({ printTemplate: t, printerWidth: found.paper as any });
  };

  const copies = Math.min(3, Math.max(1, shop.printCopies || 1));
  const isA4 = template === 'a4-invoice';
  const isA5 = template === 'a5-invoice';
  const isSheet = isA4 || isA5;
  const paperLabel = template === 'a4-invoice' ? 'A4 HĐ' : isA5 ? 'A5 HĐ' : 'K80';
  // @page theo đúng mẫu đang xem — khớp preview với hộp thoại in hệ thống
  const pageCss = isA5
    ? '@page { size: A5 landscape; margin: 8mm; } @media print { .a4-receipt-container { max-width: 100% !important; width: 100% !important; padding: 0 !important; } .break-inside-avoid { break-inside: avoid !important; page-break-inside: avoid !important; } }'
    : isA4
      ? '@page { size: A4 portrait; margin: 10mm; } @media print { .a4-receipt-container { max-width: 100% !important; width: 100% !important; padding: 0 !important; } .break-inside-avoid { break-inside: avoid !important; page-break-inside: avoid !important; } }'
      : '@page { size: 80mm auto; margin: 2mm; }';

  const headerBlock = (compact = false) => (
    <div className="text-center space-y-1 pb-2 border-b border-dashed border-slate-300">
      {shop.showLogo && <h1 className="font-extrabold text-sm uppercase tracking-wide">{shop.name}</h1>}
      {!shop.showLogo && <h1 className="font-bold text-xs uppercase">{shop.name}</h1>}
      <p className="text-[10px] text-slate-600">ĐC: {shop.address}</p>
      <p className="text-[10px] text-slate-600">Hotline / Zalo: {shop.hotline}</p>
      {!compact && shop.taxCode && <p className="text-[10px] text-slate-600">MST: {shop.taxCode}</p>}
      <div className="pt-1">
        <span className="font-bold text-xs uppercase px-2 py-0.5 bg-slate-100 rounded">
          {isDeposit ? 'PHIẾU ĐẶT HÀNG & NHẬN CỌC' : 'HÓA ĐƠN BÁN HÀNG'}
        </span>
      </div>
    </div>
  );

  const metaBlock = () => (
    <div className="space-y-0.5 text-[10px] text-slate-700 pb-2 border-b border-dashed border-slate-300">
      <div className="flex justify-between"><span>Số phiếu:</span><span className="font-bold text-slate-900">{order.order_code}</span></div>
      <div className="flex justify-between"><span>Ngày in:</span><span>{new Date(order.created_at).toLocaleString('vi-VN')}</span></div>
      {shop.showCashier && <div className="flex justify-between"><span>Thu ngân:</span><span>{order.cashier_name}</span></div>}
      <div className="flex justify-between"><span>Khách hàng:</span><span className="font-semibold text-slate-900">{order.customer_name}</span></div>
      {shop.showCustomerPhone && order.customer_phone && (
        <div className="flex justify-between"><span>SĐT:</span><span>{order.customer_phone}</span></div>
      )}
    </div>
  );

  const totalsBlock = (compact = false) => (
    <div className={`space-y-1 text-[10px] text-slate-800 pb-2 border-b border-dashed border-slate-300 ${compact ? '' : ''}`}>
      <div className="flex justify-between"><span>Tổng tiền hàng:</span><span className="font-mono">{formatVND(order.subtotal)}</span></div>
      {order.discount_amount > 0 && (
        <div className="flex justify-between text-rose-600"><span>Chiết khấu:</span><span className="font-mono">-{formatVND(order.discount_amount)}</span></div>
      )}
      {(order.vat_amount || 0) > 0 && (
        <div className="flex justify-between"><span>VAT{order.vat_percent ? ` (${order.vat_percent}%)` : ''}:</span><span className="font-mono">+{formatVND(order.vat_amount || 0)}</span></div>
      )}
      {order.shipping_fee > 0 && (
        <div className="flex justify-between"><span>Vận chuyển:</span><span className="font-mono">+{formatVND(order.shipping_fee)}</span></div>
      )}
      {order.cash_rounding > 0 && (
        <div className="flex justify-between text-amber-700 font-medium"><span>Làm tròn TM:</span><span className="font-mono">-{formatVND(order.cash_rounding)}</span></div>
      )}
      <div className="flex justify-between font-bold text-xs text-slate-950 pt-1 border-t border-slate-200">
        <span>TỔNG THANH TOÁN:</span><span className="font-mono">{formatVND(order.total_amount)}</span>
      </div>
      <div className="flex justify-between"><span>{isDeposit ? 'Cọc đã nhận:' : 'Khách đã trả:'}</span><span className="font-mono font-bold text-blue-700">{formatVND(order.paid_amount)}</span></div>
      {order.change_amount > 0 && (
        <div className="flex justify-between font-semibold text-emerald-700"><span>Tiền thừa:</span><span className="font-mono">{formatVND(order.change_amount)}</span></div>
      )}
      {shop.showDebt && order.debt_amount > 0 && (
        <div className="flex justify-between font-semibold text-rose-600"><span>{isDeposit ? 'Còn lại khi nhận hàng:' : 'Còn nợ lại:'}</span><span className="font-mono">{formatVND(order.debt_amount)}</span></div>
      )}
    </div>
  );

  const qrBlock = () => (
    <div className="py-1 flex flex-col items-center justify-center text-center space-y-1">
      {showVietqrBlock ? (
        <>
          {/* QR động theo số tiền từ img.vietqr.io — next/image không tối ưu được ảnh ngoài động + làm vỡ CSS in: giữ <img>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={buildVietqrUrl(vietqr, order.total_amount, `${order.order_code} MULTIPOS`)} alt="VietQR" className="w-28 h-28 object-contain" />
          <p className="text-[9px] text-slate-500 font-sans">{vietqr.bank} • {vietqr.account} • {formatVND(order.total_amount)}</p>
        </>
      ) : (
        <>
          <QrCode className="w-12 h-12 text-slate-800" />
          <p className="text-[9px] text-slate-500 font-sans">Quét mã để tra cứu hóa đơn</p>
        </>
      )}
    </div>
  );

  const footerBlock = () => (
    <div className="text-center pt-2 text-[9px] text-slate-500 font-sans space-y-0.5">
      {order.note && <p className="text-left bg-slate-50 p-1.5 rounded border border-slate-200 text-slate-700"><strong>Ghi chú:</strong> {order.note}</p>}
      <p className="font-bold text-slate-700">{shop.footerThanks || 'Cảm ơn Quý khách & Hẹn gặp lại!'}</p>
      {shop.receiptPolicy && <p>{shop.receiptPolicy}</p>}
      <p className="font-mono text-[8px] text-slate-400">Powered by MultiPOS • {order.order_code}</p>
    </div>
  );

  const renderK80Full = () => (
    <div style={{ zoom: k80Zoom }} className={`w-full max-w-[340px] bg-white p-4 font-mono text-slate-900 leading-tight space-y-2.5 ${fontCls}`}>
      {headerBlock()}
      {metaBlock()}
      <div className="space-y-1.5 pb-2 border-b border-dashed border-slate-300">
        <div className="flex justify-between font-bold text-[10px] uppercase border-b border-slate-200 pb-1">
          <span className="w-1/2">Tên hàng / Quy cách</span><span className="w-1/4 text-center">SL</span><span className="w-1/4 text-right">T.Tiền</span>
        </div>
        {order.items.map((it, idx) => (
          <div key={idx} className="space-y-0.5">
            <div className="flex justify-between font-semibold">
              <span className="w-1/2 line-clamp-2">{it.name}</span>
              <span className="w-1/4 text-center">{formatQty(it.quantity)} {it.unit}</span>
              <span className="w-1/4 text-right">{formatVND(it.subtotal)}</span>
            </div>
            {shop.showDimensions && it.product_type === 'area' && it.dimension_details && (
              <div className="text-[9px] text-slate-600 pl-2 space-y-0.5">
                {it.dimension_details.map((d, dIdx) => (
                  <div key={dIdx} className="flex justify-between">
                    <span>• {d.quantity}t: {d.length.toFixed(2)}m x {d.width.toFixed(2)}m ({d.actual_m2.toFixed(2)}m²)</span>
                    <span>{d.grinding_type !== 'none' ? '+ mài' : ''}</span>
                  </div>
                ))}
                {it.processing_fee > 0 && <div className="text-amber-800 font-medium">Phí GC: {formatVND(it.processing_fee)}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      {totalsBlock()}
      {qrBlock()}
      {footerBlock()}
    </div>
  );

  const renderA4 = (size: 'a4' | 'a5' = 'a4') => {
    const compact = size === 'a5';
    return (
      <div className={`a4-receipt-container w-full mx-auto ${compact ? 'max-w-[680px] p-4 text-[10px] space-y-2 leading-snug' : 'max-w-[720px] p-8 text-[12px] space-y-4'} bg-white font-sans text-slate-900 leading-relaxed`}>
        <div className={`flex justify-between items-start border-b-2 border-slate-900 ${compact ? 'pb-2' : 'pb-3'}`}>
          <div>
            <h1 className={`font-extrabold uppercase ${compact ? 'text-sm' : 'text-lg'}`}>{shop.name}</h1>
            <p>ĐC: {shop.address} • Hotline: {shop.hotline}</p>
            {(shop.taxCode || shop.email) && <p>MST: {shop.taxCode || '—'} • Email: {shop.email || '—'}</p>}
          </div>
          <div className="text-right">
            <p className={`font-extrabold uppercase ${compact ? 'text-sm' : 'text-base'}`}>{isDeposit ? 'Phiếu thu cọc' : 'Hóa đơn bán hàng'}</p>
            <p>Số: <strong>{order.order_code}</strong></p>
            <p>Ngày: {new Date(order.created_at).toLocaleString('vi-VN')}</p>
          </div>
        </div>
        <div className={`grid grid-cols-2 bg-slate-50 border border-slate-200 rounded ${compact ? 'gap-2 p-2' : 'gap-3 p-3'}`}>
          <div><span className="text-slate-500">Khách hàng: </span><strong>{order.customer_name}</strong>{shop.showCustomerPhone && order.customer_phone && <span> — {order.customer_phone}</span>}</div>
          <div><span className="text-slate-500">Thu ngân: </span>{shop.showCashier ? order.cashier_name : '—'}</div>
        </div>
        <table className="w-full border-collapse border border-slate-300">
          <thead>
            <tr className="bg-slate-100 text-center">
              <th className={`border border-slate-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} w-8 text-center`}>STT</th>
              <th className={`border border-slate-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} text-center`}>Tên hàng / Quy cách</th>
              <th className={`border border-slate-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} w-12 text-center`}>ĐVT</th>
              <th className={`border border-slate-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} w-14 text-center`}>SL</th>
              <th className={`border border-slate-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} w-20 text-center`}>Đơn giá (đ)</th>
              <th className={`border border-slate-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} w-24 text-center`}>Thành tiền (đ)</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, i) => (
              <tr key={i} className="break-inside-avoid" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <td className={`border border-slate-200 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-center`}>{i + 1}</td>
                <td className={`border border-slate-200 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}>
                  <div className="font-semibold">{it.name} <span className="font-normal text-slate-500">({it.sku})</span></div>
                  {shop.showDimensions && it.product_type === 'area' && it.dimension_details?.map((d, k) => (
                    <div key={k} className={`${compact ? 'text-[9px]' : 'text-[11px]'} text-slate-600`}>• {d.quantity} tấm {d.length.toFixed(2)}m × {d.width.toFixed(2)}m = {d.actual_m2.toFixed(2)}m²{d.grinding_type !== 'none' ? ' + mài' : ''}</div>
                  ))}
                  {it.processing_fee > 0 && <div className={`${compact ? 'text-[9px]' : 'text-[11px]'} text-amber-700`}>Phí gia công: {formatVND(it.processing_fee)}</div>}
                </td>
                <td className={`border border-slate-200 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-center`}>{it.unit}</td>
                <td className={`border border-slate-200 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-right font-mono`}>{formatQty(it.quantity)}</td>
                <td className={`border border-slate-200 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-right font-mono`}>{formatNumber(it.unit_price)}</td>
                <td className={`border border-slate-200 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-right font-mono font-bold`}>{formatNumber(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Tổng tiền — full width, chống bị ngắt đôi giữa 2 trang */}
        <div className={`w-full space-y-1 border border-slate-200 rounded ${compact ? 'p-2' : 'p-3'} break-inside-avoid`} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div className="flex justify-between"><span>Tổng hàng:</span><span className="font-mono">{formatVND(order.subtotal)}</span></div>
          {order.discount_amount > 0 && <div className="flex justify-between text-rose-600"><span>Chiết khấu:</span><span className="font-mono">-{formatVND(order.discount_amount)}</span></div>}
          {(order.vat_amount || 0) > 0 && <div className="flex justify-between"><span>VAT{order.vat_percent ? ` (${order.vat_percent}%)` : ''}:</span><span className="font-mono">+{formatVND(order.vat_amount || 0)}</span></div>}
          {order.shipping_fee > 0 && <div className="flex justify-between"><span>Vận chuyển:</span><span className="font-mono">+{formatVND(order.shipping_fee)}</span></div>}
          {order.cash_rounding > 0 && <div className="flex justify-between text-amber-700"><span>Làm tròn:</span><span className="font-mono">-{formatVND(order.cash_rounding)}</span></div>}
          <div className="flex justify-between font-bold border-t border-slate-300 pt-1"><span>TỔNG CỘNG:</span><span className="font-mono">{formatVND(order.total_amount)}</span></div>
          <div className="flex justify-between"><span>Đã thanh toán:</span><span className="font-mono font-bold">{formatVND(order.paid_amount)}</span></div>
          {order.debt_amount > 0 && <div className="flex justify-between text-rose-600 font-bold"><span>Còn phải thu:</span><span className="font-mono">{formatVND(order.debt_amount)}</span></div>}
        </div>
        {/* Ký tên + QR + footer — break-inside-avoid */}
        <div className="break-inside-avoid" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          {/* Chữ ký — QR bên trái, ký tên bên phải */}
          <div className={`flex items-stretch ${compact ? 'gap-3' : 'gap-4'}`}>
            {/* Khối QR bên trái */}
            <div className={`shrink-0 flex flex-col items-center justify-center border border-slate-200 rounded ${compact ? 'p-1.5 min-w-[84px]' : 'p-2 min-w-[110px]'}`}>
              {showVietqrBlock ? (
                <>
                  {/* QR động theo số tiền từ img.vietqr.io — next/image không tối ưu được ảnh ngoài động + làm vỡ CSS in: giữ <img>. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={buildVietqrUrl(vietqr, order.total_amount, `${order.order_code} MULTIPOS`)} alt="VietQR" className={`${compact ? 'w-16 h-16' : 'w-20 h-20'} object-contain`} />
                  <p className={`font-bold text-center ${compact ? 'text-[9px] mt-0.5' : 'text-[10px] mt-1'}`}>Thanh toán VietQR</p>
                  <p className={`text-slate-500 text-center ${compact ? 'text-[8px]' : 'text-[9px]'}`}>{vietqr.bank} • {vietqr.account}</p>
                  <p className={`font-mono font-bold text-center ${compact ? 'text-[9px]' : 'text-[10px]'}`}>{formatVND(order.debt_amount > 0 ? order.debt_amount : order.total_amount)}</p>
                </>
              ) : (
                <>
                  <QrCode className={`${compact ? 'w-12 h-12' : 'w-16 h-16'} text-slate-700`} />
                  <p className={`text-slate-400 text-center ${compact ? 'text-[8px] mt-0.5' : 'text-[9px] mt-1'}`}>Quét mã tra cứu hóa đơn</p>
                </>
              )}
            </div>
            {/* Khối ký tên bên phải */}
            <div className="flex-1 grid grid-cols-2 text-center border border-slate-200 rounded">
              <div className={`flex flex-col items-center justify-start border-r border-slate-200 ${compact ? 'p-2' : 'p-3'}`}>
                <p className="font-bold">Khách hàng</p>
                <p className={`text-slate-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>(Ký, ghi rõ họ tên)</p>
                <div className="flex-1" />
              </div>
              <div className={`flex flex-col items-center justify-start ${compact ? 'p-2' : 'p-3'}`}>
                <p className="font-bold">Thu ngân</p>
                <p className={`text-slate-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{shop.showCashier ? order.cashier_name : ''}</p>
                <div className="flex-1" />
              </div>
            </div>
          </div>
          {showVietqrBlock && order.note && <p className={`bg-slate-50 border border-slate-200 rounded ${compact ? 'mt-1.5 p-1.5' : 'mt-2 p-2'}`}><strong>Ghi chú:</strong> {order.note}</p>}
          <p className={`text-center text-slate-500 ${compact ? 'text-[10px] pt-1' : 'text-[11px] pt-2'}`}>{shop.footerThanks} {shop.receiptPolicy && `• ${shop.receiptPolicy}`}</p>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    switch (template) {
      case 'a4-invoice': return renderA4('a4');
      case 'a5-invoice': return renderA4('a5');
      default: return renderK80Full();
    }
  };

  return (
    <div id="receipt-modal-overlay" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
      {/* Khổ giấy in theo đúng mẫu đang xem */}
      <style>{pageCss}</style>
      <div id="receipt-modal-container" className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-xs">{isDeposit ? 'PHIẾU ĐẶT HÀNG & NHẬN CỌC' : template === 'a5-invoice' ? 'HÓA ĐƠN BÁN HÀNG (A5)' : template.startsWith('a4') ? 'HÓA ĐƠN BÁN HÀNG (A4)' : `HÓA ĐƠN ${paperLabel}`} — {order.order_code}</h3>
          </div>
          <button onClick={() => setReceiptModalOrder(null)} className="p-1 text-slate-400 hover:text-white rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1"><Receipt className="w-3.5 h-3.5" /> Mẫu in:</span>
          <select value={template} onChange={(e) => handlePickTemplate(e.target.value as PrintTemplate)} className="h-8 px-2 text-xs border border-slate-300 rounded-md font-semibold bg-white">
            {PRINT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <span className="text-[11px] text-slate-500">{PRINT_TEMPLATES.find((t) => t.id === template)?.desc}</span>
          <span className="ml-auto text-[11px] font-mono text-slate-500">In {copies} liên • {shop.printerWidth}</span>
        </div>

        <div className="print-preview-wrap flex-1 overflow-y-auto p-4 bg-slate-100 flex justify-center">
          <div id="print-area" data-template={template} data-paper={shop.printerWidth} className={`shadow-sm border border-slate-200 ${isSheet ? '' : 'rounded'}`}>
            {Array.from({ length: copies }).map((_, i) => (
              <div key={i} className={i > 0 ? (isSheet ? 'print-page-break' : 'print-cut-line') : ''}>
                {i > 0 && !isSheet && <div className="print-only text-center text-[10px] font-mono text-slate-500 py-2">✂ - - LIÊN {i + 1} - - ✂</div>}
                {renderBody()}
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between gap-2">
          <button onClick={() => setReceiptModalOrder(null)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Đóng</button>
          <div className="flex items-center gap-2">
            <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={!!shop.autoPrint} onChange={(e) => updateShop({ autoPrint: e.target.checked })} className="w-3.5 h-3.5 accent-blue-600" /> Tự in lần sau
            </label>
            {/* Điện thoại: mở tab in riêng (nút In / Lưu PDF) vì mobile chặn auto-print iframe */}
            <button
              id="btn-print-receipt-mobile"
              onClick={handlePrintMobile}
              className="lg:hidden px-4 h-10 border border-blue-200 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg flex items-center gap-1.5"
            >
              <Share2 className="w-4 h-4" />
              <span>In / Lưu PDF</span>
            </button>
            <button id="btn-print-receipt" onClick={handlePrint} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm flex items-center gap-1.5">
              <Printer className="w-4 h-4" /><span>In {paperLabel} × {copies}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
