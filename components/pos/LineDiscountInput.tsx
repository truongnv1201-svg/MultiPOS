'use client';

import { NumberInput } from '@/components/common/NumberInput';
import { editCellClass } from '@/components/common/EditableCell';

interface LineDiscountInputProps {
    percent: number;
    onCommit: (percent: number) => void;
    ariaLabel: string;
    title?: string;
    /** true khi dòng đang có CK -> chữ đỏ như ô đã sửa giá (cùng ngôn ngữ "đã sửa"). */
    active?: boolean;
    width?: string;
}

/**
 * Ô chiết khấu riêng từng dòng ở giỏ POS (thu ngân dùng được, xem POSScreen).
 *
 * - Nhập % gọn (cho số lẻ, kẹp 0..100), caller quy ra tiền bằng
 *   lineDiscountFromPercent (lib/pricing) rồi updateCartItem discount_amount.
 * - Cùng style ô sửa với số lượng/đơn giá (EditableCell): nghỉ chữ xanh,
 *   đang có CK chữ đỏ, placeholder 0 mờ.
 * - Server kẹp CK dòng ≤ tiền dòng lần cuối (pos_checkout) nên nhập lố cũng
 *   không lọt (xem guard pos-cart).
 */
export function LineDiscountInput({
    percent,
    onCommit,
    ariaLabel,
    title,
    active = false,
    width = 'w-16',
}: LineDiscountInputProps) {
    return (
        <NumberInput
            value={percent}
            allowDecimals
            placeholder="0"
            aria-label={ariaLabel}
            title={title ?? 'Chiết khấu riêng dòng này (% trên tiền dòng) — trừ trước CK cả bill (F8)'}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(value) => {
                if (value >= 0) onCommit(Math.min(100, Math.round(value * 10) / 10));
            }}
            className={editCellClass(width, `text-right ${active ? 'text-rose-700!' : ''}`)}
        />
    );
}
