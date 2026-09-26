'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Đóng popup khi bấm ra ngoài vùng ref — dùng chung cho các ô tìm kiếm có dropdown
 * (tìm hàng hóa POS, tìm khách hàng POS, chọn NCC/khách trong sheet).
 * Lắng nghe 'mousedown' để đóng trước khi focus chuyển đi (như SearchableSelect cũ).
 */
export function useClickOutside<T extends HTMLElement>(
    ref: RefObject<T | null>,
    active: boolean,
    onOutside: () => void
) {
    const callbackRef = useRef(onOutside);

    useEffect(() => {
        callbackRef.current = onOutside;
    }, [onOutside]);

    useEffect(() => {
        if (!active) return;
        const handler = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (ref.current && !ref.current.contains(target)) callbackRef.current();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [ref, active]);
}
