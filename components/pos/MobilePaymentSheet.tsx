'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, FileSpreadsheet, Plus, QrCode, User, X } from 'lucide-react';
import { formatVND } from '@/lib/format';
import { useClickOutside } from '@/lib/useClickOutside';
import type { Customer } from '@/lib/types';

export type MobilePaymentMethod = 'cash' | 'transfer' | 'card' | 'debt';

interface MobilePaymentSheetProps {
    open: boolean;
    onClose: () => void;
    itemCount: number;
    subtotal: number;
    payable: number;
    cashRounding: number;
    changeAmount: number;
    debtAmount: number;
    paymentMethod: MobilePaymentMethod;
    onPaymentMethodChange: (method: MobilePaymentMethod) => void;
    tenderedAmount: number;
    onTenderedChange: (amount: number) => void;
    onQuickTender: (amount: number) => void;
    customers: Customer[];
    selectedCustomer: Customer | null;
    customerName: string;
    onSelectCustomer: (customer: Customer) => void;
    onQuickAddCustomer: () => void;
    note: string;
    onNoteChange: (note: string) => void;
    canCheckout: boolean;
    isProcessing: boolean;
    needLogin: boolean;
    onLogin: () => void;
    shiftClosed: boolean;
    onOpenShift: () => void;
    onCheckout: () => void;
}

const METHODS: { key: MobilePaymentMethod; label: string; icon: typeof Banknote; active: string; idle: string }[] = [
    { key: 'cash', label: 'Tiền mặt', icon: Banknote, active: 'bg-blue-600 text-white border-blue-600', idle: 'bg-white text-slate-700 border-slate-200' },
    { key: 'transfer', label: 'VietQR', icon: QrCode, active: 'bg-blue-600 text-white border-blue-600', idle: 'bg-white text-slate-700 border-slate-200' },
    { key: 'card', label: 'Quẹt thẻ', icon: CreditCard, active: 'bg-blue-600 text-white border-blue-600', idle: 'bg-white text-slate-700 border-slate-200' },
    { key: 'debt', label: 'Ghi nợ', icon: FileSpreadsheet, active: 'bg-amber-500 text-white border-amber-500', idle: 'bg-white text-slate-700 border-slate-200' },
];

const QUICK_TENDERS = [500000, 1000000, 2000000, 5000000];

export default function MobilePaymentSheet({
    open,
    onClose,
    itemCount,
    subtotal,
    payable,
    cashRounding,
    changeAmount,
    debtAmount,
    paymentMethod,
    onPaymentMethodChange,
    tenderedAmount,
    onTenderedChange,
    onQuickTender,
    customers,
    selectedCustomer,
    customerName,
    onSelectCustomer,
    onQuickAddCustomer,
    note,
    onNoteChange,
    canCheckout,
    isProcessing,
    needLogin,
    onLogin,
    shiftClosed,
    onOpenShift,
    onCheckout,
}: MobilePaymentSheetProps) {
    const [customerQuery, setCustomerQuery] = useState('');
    const customerWrapRef = useRef<HTMLDivElement>(null);
    // Bấm ra ngoài thì đóng danh sách gợi ý khách hàng
    const closeCustomerList = useCallback(() => setCustomerQuery(''), []);
    useClickOutside(customerWrapRef, customerQuery.trim() !== '', closeCustomerList);

    const matches = useMemo(() => {
        const q = customerQuery.trim().toLowerCase();
        if (!q) return customers.slice(0, 20);
        return customers
            .filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.code || '').toLowerCase().includes(q))
            .slice(0, 20);
    }, [customers, customerQuery]);

    if (!open) return null;

    return (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="Thanh toán">
            <button type="button" className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Đóng" />
            <div className="relative w-full max-h-[90dvh] bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900">Thanh toán</h2>
                        <p className="text-[11px] text-slate-500 font-medium">
                            {itemCount} món · tạm tính {formatVND(subtotal)}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:bg-slate-200"
                        aria-label="Đóng thanh toán"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                    <div className="rounded-xl bg-slate-900 px-4 py-3 text-white">
                        <p className="text-[11px] text-slate-300">KHÁCH CẦN TRẢ</p>
                        <p className="text-2xl font-black font-mono">{formatVND(payable)}</p>
                        {cashRounding > 0 && paymentMethod === 'cash' && (
                            <p className="mt-0.5 text-[10px] text-amber-300 font-medium">Đã làm tròn tiền mặt: -{formatVND(cashRounding)}</p>
                        )}
                    </div>

                    {(needLogin || shiftClosed) && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
                            {needLogin ? (
                                <>
                                    Chưa đăng nhập thu ngân —{' '}
                                    <button type="button" onClick={onLogin} className="font-bold underline">
                                        Đăng nhập
                                    </button>{' '}
                                    để bán hàng.
                                </>
                            ) : (
                                <>
                                    Ca làm việc đã đóng —{' '}
                                    <button type="button" onClick={onOpenShift} className="font-bold underline">
                                        Mở ca mới (F12)
                                    </button>{' '}
                                    trước khi thu tiền.
                                </>
                            )}
                        </div>
                    )}

                    <div ref={customerWrapRef} className="relative">
                        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1">
                            <User className="w-3.5 h-3.5 text-blue-600" />
                            Khách hàng
                        </label>
                        {selectedCustomer ? (
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-800 truncate">{selectedCustomer.name}</p>
                                    <p className="text-[10px] text-slate-500 font-mono">
                                        {selectedCustomer.phone || '—'} · nợ {formatVND(selectedCustomer.current_debt)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setCustomerQuery('')}
                                    className="shrink-0 text-[11px] font-bold text-blue-700 underline"
                                >
                                    Đổi
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <input
                                        id="mobile-payment-customer-input"
                                        type="text"
                                        value={customerQuery}
                                        onChange={(e) => setCustomerQuery(e.target.value)}
                                        placeholder={customerName || 'Tìm theo tên / SĐT / mã...'}
                                        className="h-11 flex-1 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={onQuickAddCustomer}
                                        className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100"
                                        aria-label="Thêm nhanh khách hàng"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                                {customerQuery.trim() !== '' && (
                                    <div id="mobile-payment-customer-list" className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                                        {matches.length === 0 ? (
                                            <p className="px-3 py-3 text-[11px] text-slate-400">Không tìm thấy khách hàng.</p>
                                        ) : (
                                            matches.map((cust) => (
                                                <button
                                                    key={cust.id}
                                                    type="button"
                                                    onClick={() => onSelectCustomer(cust)}
                                                    className="w-full px-3 py-2 text-left active:bg-blue-50"
                                                >
                                                    <span className="block text-xs font-semibold text-slate-800">{cust.name}</span>
                                                    <span className="block text-[10px] text-slate-500 font-mono">
                                                        {cust.phone || '—'} · nợ {formatVND(cust.current_debt)}
                                                    </span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Phương thức thanh toán</label>
                        <div className="grid grid-cols-4 gap-1.5">
                            {METHODS.map((m) => {
                                const Icon = m.icon;
                                const isActive = paymentMethod === m.key;
                                return (
                                    <button
                                        key={m.key}
                                        type="button"
                                        onClick={() => onPaymentMethodChange(m.key)}
                                        className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-bold transition-colors ${isActive ? m.active : m.idle}`}
                                    >
                                        <Icon className="w-5 h-5" />
                                        <span className="text-center leading-tight">{m.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {paymentMethod !== 'debt' && (
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tiền khách đưa</label>
                            <input
                                id="mobile-payment-tendered-input"
                                type="text"
                                inputMode="numeric"
                                value={tenderedAmount ? new Intl.NumberFormat('vi-VN').format(tenderedAmount) : ''}
                                onChange={(e) => {
                                    const digits = e.target.value.replace(/[^\d]/g, '');
                                    onTenderedChange(digits ? Number(digits) : 0);
                                }}
                                placeholder="0"
                                className="h-12 w-full px-3 text-right font-mono font-bold text-lg text-blue-700 bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden"
                            />
                            <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => onQuickTender(payable)}
                                    className="h-9 rounded-lg border border-slate-300 bg-white text-[10px] font-bold text-slate-700 active:bg-slate-100"
                                >
                                    Đủ tiền
                                </button>
                                {QUICK_TENDERS.map((amount) => (
                                    <button
                                        key={amount}
                                        type="button"
                                        onClick={() => onQuickTender(amount)}
                                        className="h-9 rounded-lg border border-slate-300 bg-white text-[10px] font-mono font-semibold text-slate-700 active:bg-slate-100"
                                    >
                                        {amount / 1000000}M
                                    </button>
                                ))}
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                                {changeAmount > 0 ? (
                                    <>
                                        <span className="text-emerald-700">Tiền thừa trả khách</span>
                                        <span className="font-mono text-emerald-700">{formatVND(changeAmount)}</span>
                                    </>
                                ) : debtAmount > 0 ? (
                                    <>
                                        <span className="text-amber-700">Còn thiếu (ghi nợ)</span>
                                        <span className="font-mono text-amber-700">{formatVND(debtAmount)}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-slate-500">Tiền thừa</span>
                                        <span className="font-mono text-slate-500">0 đ</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {paymentMethod === 'debt' && !selectedCustomer && (
                        <p className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 leading-relaxed">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            Ghi nợ cần chọn khách hàng trước khi thu tiền.
                        </p>
                    )}

                    <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ghi chú đơn hàng</label>
                        <textarea
                            id="mobile-payment-note"
                            value={note}
                            onChange={(e) => onNoteChange(e.target.value)}
                            placeholder="Hẹn giao, quy cách phụ..."
                            rows={2}
                            className="w-full p-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden"
                        />
                    </div>
                </div>

                <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <button
                        type="button"
                        id="btn-pos-mobile-payment-confirm"
                        onClick={onCheckout}
                        disabled={!canCheckout}
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white active:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                        <CheckCircle2 className="w-5 h-5" />
                        {isProcessing ? 'Đang xử lý…' : `Thu ${formatVND(payable)}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
