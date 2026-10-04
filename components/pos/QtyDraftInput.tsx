'use client';

import { useState } from 'react';
import { formatQty, parseQtyInput, snapQty } from '@/lib/quantity';
import { editCellClass } from '@/components/common/EditableCell';

interface QtyDraftInputProps {
    quantity: number;
    allowDecimal: boolean;
    onCommit: (quantity: number) => void;
    ariaLabel: string;
    /** Chiều rộng ô (mặc định vừa cột "SL / Diện tích"). */
    width?: string;
    className?: string;
}

/**
 * Ô nhập số lượng trong giỏ (bảng POS + sheet mobile).
 *
 * Vì sao không dùng type="number": khi gõ "1." trình duyệt báo value = "" (chưa là
 * số hợp lệ) nên parse ra NaN và số lượng rơi về 0.001. Ô này giữ "bản nháp" khi đang
 * gõ (1 → 1. → 1.2) và chỉ chốt giá trị hợp lệ; xóa hết thì giữ nguyên số cũ thay vì
 * nhảy về 0.001.
 */
export function QtyDraftInput({
    quantity,
    allowDecimal,
    onCommit,
    ariaLabel,
    width = 'w-24',
    className = '',
}: QtyDraftInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const display = draft ?? formatQty(quantity, allowDecimal);

    const commit = (raw: string | null) => {
        const parsed = raw === null ? quantity : parseQtyInput(raw);
        setDraft(null);
        onCommit(snapQty(parsed > 0 ? parsed : quantity, allowDecimal));
    };

    return (
        <input
            id={`qty-input-${ariaLabel}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={display}
            aria-label={ariaLabel}
            onChange={(e) => {
                const next = e.target.value;
                setDraft(/^\d+$/.test(next) ? formatQty(parseQtyInput(next)) : next);
                const parsed = parseQtyInput(next);
                // Cập nhật giỏ ngay khi giá trị hợp lệ để thành tiền chạy theo;
                // giá trị rỗng/đang gõ dở thì giữ nguyên số cũ, không rơi về 0.001.
                if (parsed > 0) onCommit(snapQty(parsed, allowDecimal));
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                    setDraft(null);
                    e.currentTarget.blur();
                }
            }}
            // Style chung với ô đơn giá (components/common/EditableCell) để cả hai ô
            // sửa được trong giỏ trông như một.
            className={`${editCellClass(width, `text-center ${className}`)}`}
        />
    );
}
