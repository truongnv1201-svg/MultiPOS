'use client';

import { useState } from 'react';
import { formatVND } from '@/lib/format';
import { parseQtyInput } from '@/lib/quantity';

export const PRICE_MIN = 0;
export const PRICE_MAX = 100_000_000; // khớp kẹp giá ở migration 0059 (pos_checkout)

interface PriceDraftInputProps {
    price: number;
    onCommit: (price: number) => void;
    ariaLabel: string;
    /** true khi dòng này đang lệch giá danh mục -> hiện nhãn "đã sửa". */
    overridden?: boolean;
    className?: string;
}

/**
 * Ô sửa đơn giá tại giỏ POS (chỉ Quản lý/Admin, xem POSScreen).
 *
 * - Chưa gõ: hiện giá format VND, gạch chân mờ để thấy là chỗ sửa được.
 * - Đang gõ: giữ "bản nháp" (20000 -> 20000 -> 200000) và chỉ chốt giá hợp lệ;
 *   xóa hết thì giữ giá cũ thay vì rơi về 0 (giá 0 sẽ làm đơn sai tiền).
 * - Enter chốt, Escape huỷ.
 * - Server vẫn chặn lần cuối: pos_checkout chỉ nhận price_override khi is_manager()
 *   (migration 0059), nên sửa giá ở UI không vượt được chặn phía server.
 */
export function PriceDraftInput({
    price,
    onCommit,
    ariaLabel,
    overridden = false,
    className = '',
}: PriceDraftInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);

    const clamp = (value: number) => Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(value)));

    const commit = (raw: string | null) => {
        setEditing(false);
        if (raw === null) {
            setDraft(null);
            return;
        }
        const parsed = parseQtyInput(raw);
        // Rỗng/0 -> giữ giá cũ: không cho tạo đơn 0đ bằng cách xoá ô.
        setDraft(null);
        if (parsed > 0) onCommit(clamp(parsed));
    };

    if (!editing) {
        return (
            <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={ariaLabel}
                title={overridden ? 'Đã sửa đơn giá cho đơn này — bấm để sửa tiếp' : 'Sửa đơn giá cho đơn này'}
                className={`ml-auto block rounded px-1 font-mono text-slate-700 hover:bg-blue-50 hover:text-blue-800 hover:underline decoration-dotted underline-offset-2 ${overridden ? 'text-amber-700' : ''} ${className}`}
            >
                {formatVND(price)}
            </button>
        );
    }

    return (
        <input
            autoFocus
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={ariaLabel}
            value={draft ?? String(Math.round(price))}
            onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                const parsed = parseQtyInput(next);
                if (parsed > 0) onCommit(clamp(parsed));
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft(null);
                    setEditing(false);
                }
            }}
            className={`ml-auto block w-full rounded border border-blue-400 bg-white px-1 text-right font-mono font-bold text-slate-900 focus:border-blue-500 focus:outline-hidden ${className}`}
        />
    );
}
