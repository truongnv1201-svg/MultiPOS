'use client';

import { NumberInput } from '@/components/common/NumberInput';
import { editCellClass } from '@/components/common/EditableCell';

export const PRICE_MIN = 0;
export const PRICE_MAX = 100_000_000; // khớp kẹp giá ở migration 0059 (pos_checkout)

interface PriceDraftInputProps {
    price: number;
    onCommit: (price: number) => void;
    ariaLabel: string;
    /** true khi dòng này đang lệch giá danh mục -> tô nhạt để thấy đã sửa. */
    overridden?: boolean;
    width?: string;
}

/**
 * Ô sửa đơn giá tại giỏ POS (chỉ Quản lý/Admin, xem POSScreen).
 *
 * - Dùng CHUNG NumberInput + style ô sửa được với ô số lượng (components/common/EditableCell)
 *   nên hai ô trông giống hệt nhau, đều hiện dấu phân cách nghìn kiểu VN (15.000).
 * - Gõ/xoá không giữ được số thì giữ giá cũ: giá 0 làm đơn sai tiền, không cho tạo.
 * - Server vẫn chặn lần cuối: pos_checkout chỉ nhận price_override khi is_manager()
 *   (migration 0059), nên sửa ở UI không vượt được chặn phía server.
 */
export function PriceDraftInput({
    price,
    onCommit,
    ariaLabel,
    overridden = false,
    width = 'w-24',
}: PriceDraftInputProps) {
    return (
        <NumberInput
            value={price}
            allowDecimals={false}
            placeholder="0"
            aria-label={ariaLabel}
            title={
                overridden
                    ? 'Đã sửa đơn giá cho đơn này — giá danh mục không bị đổi'
                    : 'Sửa đơn giá cho riêng đơn đang bán (không đổi giá danh mục)'
            }
            onFocus={(e) => e.currentTarget.select()}
            onChange={(value) => {
                if (value > PRICE_MIN) onCommit(Math.min(PRICE_MAX, Math.round(value)));
            }}
            className={editCellClass(
                width,
                // Ô đã sửa giá: đổi màu ĐƯỜNG GẠCH CHÂN sang hổ phách, chữ vẫn xanh
                // (đồng nhất với các ô sửa được khác). Cần `!` vì EDIT_CELL_CLASS đã có
                // border-b-slate-200 và Tailwind xếp utility theo thứ tự -> không `!` thì
                // màu này không bao giờ thắng, cảnh báo "đã sửa giá" vô hình.
                // `focus:...!` buộc khi đang gõ thì gạch chân về xanh như mọi ô khác, blur
                // ra lại hổ phách (nếu không có, dòng đã sửa mất phản hồi khi focus).
                `text-right font-semibold ${
                    overridden ? 'border-b-amber-500! focus:border-b-blue-600!' : ''
                }`
            )}
        />
    );
}
