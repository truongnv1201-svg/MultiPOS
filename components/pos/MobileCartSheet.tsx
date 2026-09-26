'use client';

import { CheckCircle2, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { formatVND } from '@/lib/format';
import { formatQty, qtyStep, snapQty } from '@/lib/quantity';
import { QtyDraftInput } from '@/components/pos/QtyDraftInput';
import type { OrderItem } from '@/lib/types';

interface MobileCartSheetProps {
    open: boolean;
    onClose: () => void;
    items: OrderItem[];
    payable: number;
    canCheckout: boolean;
    checkoutLabel: string;
    onQuantityChange: (itemId: string, quantity: number) => void;
    onRemove: (itemId: string) => void;
    onEditDimension: (item: OrderItem) => void;
    /** Mặt hàng này có bán số lượng thập phân không (2,15 kg) — quyết định bước tăng/giảm và cách hiển thị. */
    allowsDecimal: (item: OrderItem) => boolean;
    onClear: () => void;
    onCheckout: () => void;
}

export default function MobileCartSheet({
    open,
    onClose,
    items,
    payable,
    canCheckout,
    checkoutLabel,
    onQuantityChange,
    onRemove,
    onEditDimension,
    allowsDecimal,
    onClear,
    onCheckout,
}: MobileCartSheetProps) {
    if (!open) return null;

    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
    return (
        <div id="cart-record-list" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Giỏ hàng">
            <button type="button" className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Đóng giỏ" />
            <div className="relative w-full sm:max-w-md max-h-[88dvh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900">Giỏ hàng</h2>
                        <p className="text-[11px] text-slate-500 font-medium">
                            {items.length} món · {formatQty(totalQty)} tổng cộng
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:bg-slate-200"
                        aria-label="Đóng giỏ hàng"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
                    {items.length === 0 ? (
                        <div className="px-4 py-10 text-center">
                            <p className="text-sm font-semibold text-slate-700">Giỏ đang trống</p>
                            <p className="mt-1 text-[11px] text-slate-500">Chạm một sản phẩm để thêm vào đơn.</p>
                        </div>
                    ) : (
                        items.map((item) => {
                            const isArea = item.product_type === 'area';
                            const allowDecimal = allowsDecimal(item);
                            const step = qtyStep(allowDecimal);
                            return (
                                <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-semibold text-slate-800 leading-snug">{item.name}</p>
                                        <p className="mt-0.5 text-[11px] text-slate-500 font-mono">
                                            {formatVND(item.unit_price)}/{item.unit}
                                            {item.processing_fee > 0 ? ` · phí +${formatVND(item.processing_fee)}` : ''}
                                            {item.discount_amount > 0 ? ` · giảm -${formatVND(item.discount_amount)}` : ''}
                                        </p>
                                        <div className="mt-1.5 flex items-center gap-2">
                                            {isArea ? (
                                                <>
                                                    <span className="px-2 py-1 rounded-md bg-slate-100 text-[11px] font-mono font-bold text-slate-700">
                                                        {formatQty(item.quantity)} {item.unit}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => onEditDimension(item)}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-200 text-blue-600 bg-blue-50 active:bg-blue-100"
                                                        aria-label={`Sửa kích thước ${item.name}`}
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <div className="inline-flex items-center rounded-lg border border-slate-200 overflow-hidden">
                                                    <button
                                                        type="button"
                                                        onClick={() => onQuantityChange(item.id, snapQty(item.quantity - step, allowDecimal))}
                                                        className="inline-flex h-9 w-9 items-center justify-center text-slate-600 active:bg-slate-100"
                                                        aria-label={`Giảm số lượng ${item.name}`}
                                                    >
                                                        <Minus className="w-4 h-4" />
                                                    </button>
                                                    <QtyDraftInput
                                                        quantity={item.quantity}
                                                        allowDecimal={allowDecimal}
                                                        onCommit={(value) => onQuantityChange(item.id, value)}
                                                        ariaLabel={`Số lượng ${item.name}`}
                                                        className="w-14 h-9"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => onQuantityChange(item.id, snapQty(item.quantity + step, allowDecimal))}
                                                        className="inline-flex h-9 w-9 items-center justify-center text-slate-600 active:bg-slate-100"
                                                        aria-label={`Tăng số lượng ${item.name}`}
                                                    >
                                                        <Plus className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-2 shrink-0">
                                        <span className="text-[13px] font-mono font-bold text-slate-900">{formatVND(item.subtotal)}</span>
                                        <button
                                            type="button"
                                            onClick={() => onRemove(item.id)}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 bg-rose-50 active:bg-rose-100"
                                            aria-label={`Xóa ${item.name}`}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-600">Tạm tính</span>
                        <span className="text-lg font-mono font-black text-slate-900">{formatVND(payable)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={onClear}
                            disabled={items.length === 0}
                            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-600 active:bg-slate-100 disabled:opacity-40"
                        >
                            <Trash2 className="w-4 h-4" />
                            Xóa giỏ
                        </button>
                        <button
                            type="button"
                            onClick={onCheckout}
                            disabled={!canCheckout}
                            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-bold text-white active:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
                        >
                            <CheckCircle2 className="w-4 h-4" />
                            {checkoutLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
