'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

// Sheet dùng chung cho mọi modal nghiệp vụ (Giai đoạn 3): trên điện thoại trượt lên từ đáy
// (bottom sheet) để bàn tay che được nút, trên desktop giữ dạng hộp thoại canh giữa.
// Giữ nguyên API cũ: chỉ cần open/onClose/title/children, các id trong form không đổi.
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
