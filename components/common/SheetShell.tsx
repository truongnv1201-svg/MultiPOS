'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Sheet dùng chung cho mọi modal nghiệp vụ (Giai đoạn 3): trên điện thoại trượt lên từ đáy
// (bottom sheet) để bàn tay che được nút, trên desktop giữ dạng hộp thoại canh giữa.
// Giữ nguyên API cũ: chỉ cần open/onClose/title/children, các id trong form không đổi.
// A11y: Escape đóng, Tab bị giữ trong sheet, focus nhảy vào ô nhập đầu tiên khi mở
// và trả về nút đang bấm khi đóng.
interface SheetShellProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    icon?: ReactNode;
    label: string;
    children: ReactNode;
    size?: 'md' | 'lg';
}

export function SheetShell({ open, onClose, title, icon, label, children, size = 'md' }: SheetShellProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const restoreRef = useRef<Element | null>(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        // Nhớ chỗ đang focus để đóng sheet trả focus lại (bàn phím không rơi vào body)
        restoreRef.current = document.activeElement;
        const focusTimer = window.setTimeout(() => {
            const panel = panelRef.current;
            if (!panel) return;
            const first = panel.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
            (first ?? panel).focus();
        }, 0);

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // Không stopPropagation: dropdown con (SearchableSelect...) tự đóng trước,
                // sheet đóng theo sau cùng lượt phím.
                onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab') return;
            const panel = panelRef.current;
            if (!panel) return;
            const els = Array.from(
                panel.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])')
            ).filter((el) => !el.hasAttribute('disabled'));
            if (els.length === 0) {
                e.preventDefault();
                panel.focus();
                return;
            }
            const first = els[0];
            const last = els[els.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || !panel.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', onKey);
            const el = restoreRef.current as HTMLElement | null;
            if (el && el.isConnected) el.focus();
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={label}
        >
            <button type="button" className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-label="Đóng" />
            <div
                ref={panelRef}
                tabIndex={-1}
                className={`relative w-full ${size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92dvh] bg-white sm:rounded-xl rounded-t-2xl shadow-xl border border-slate-200 flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]`}
            >
                <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-2 shrink-0">
                    <span className="font-bold text-sm flex items-center gap-2 min-w-0">{icon}{title}</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 p-1 text-slate-400 hover:text-white rounded"
                        aria-label="Đóng cửa sổ"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
