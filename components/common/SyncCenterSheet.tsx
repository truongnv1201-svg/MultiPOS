'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { db, type PendingMasterData, type PendingOp } from '@/lib/db';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';
import type { Order } from '@/lib/types';

interface SyncCenterSheetProps {
    open: boolean;
    onClose: () => void;
}

const KIND_LABEL: Record<PendingOp['kind'], string> = {
    import: 'Nhập kho',
    voucher: 'Phiếu thu/chi',
    supplier_payment: 'Trả nợ NCC',
};

const ENTITY_LABEL: Record<PendingMasterData['entity'], string> = {
    product: 'Sản phẩm',
    customer: 'Khách hàng',
    supplier: 'Nhà cung cấp',
};

function formatTime(value?: string) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export default function SyncCenterSheet({ open, onClose }: SyncCenterSheetProps) {
    const { isOnline, realtimeLive, lastSyncAt, lastSyncError, pendingQueue, setPendingQueue, refreshNow, syncPendingOps } = useStore();
    const [ops, setOps] = useState<PendingOp[]>([]);
    const [masters, setMasters] = useState<PendingMasterData[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [busy, setBusy] = useState(false);

    const reload = useCallback(async () => {
        const [opRows, masterRows, orderRows] = await Promise.all([
            db.pendingOps.toArray(),
            db.pendingMasterData.toArray(),
            db.pendingOrders.toArray(),
        ]);
        setOps(opRows);
        setMasters(masterRows);
        setOrders(orderRows);
    }, []);

    useEffect(() => {
        if (!open) return;
        let active = true;
        const timer = setTimeout(() => {
            if (active) void reload();
        }, 0);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [open, reload, pendingQueue.length]);

    if (!open) return null;

    const totalPending = ops.length + masters.length + orders.length;
    const failedCount = ops.filter((op) => op.status === 'failed').length + masters.filter((m) => m.status === 'failed').length;

    const handleSync = async () => {
        setBusy(true);
        try {
            await refreshNow();
            await reload();
        } finally {
            setBusy(false);
        }
    };

    const handleRetryFailed = async () => {
        setBusy(true);
        try {
            const result = await syncPendingOps(true);
            await reload();
            notify(result.failed > 0 ? `Còn ${result.failed} thao tác chưa đồng bộ được` : `Đã gửi lại ${result.synced} thao tác`, result.failed > 0 ? 'error' : 'success');
        } finally {
            setBusy(false);
        }
    };

    const handleDiscard = async () => {
        const ok = await confirmDialog(`Xóa ${totalPending} thao tác đang chờ?\nDữ liệu tạm trên máy sẽ mất và không thể gửi lên server.`, {
            title: 'Xóa hàng đợi đồng bộ',
            danger: true,
            confirmLabel: 'Xóa hết',
        });
        if (!ok) return;
        setBusy(true);
        try {
            await Promise.all([db.pendingOps.clear(), db.pendingMasterData.clear(), db.pendingOrders.clear()]);
            setPendingQueue([]);
            await reload();
            notify('Đã xóa hàng đợi đồng bộ', 'success');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Trung tâm đồng bộ">
            <button type="button" className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Đóng" />
            <div className="relative w-full sm:max-w-md max-h-[88dvh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900">Trung tâm đồng bộ</h2>
                        <p className="text-[11px] text-slate-500 font-medium">
                            {lastSyncAt ? `Lần đồng bộ gần nhất ${new Date(lastSyncAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Chưa đồng bộ lần nào'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:bg-slate-200"
                        aria-label="Đóng trung tâm đồng bộ"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                                isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}
                        >
                            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                            {isOnline ? 'Có mạng' : 'Mất mạng'}
                        </span>
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                                realtimeLive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                            }`}
                        >
                            {realtimeLive ? 'Realtime' : 'Không realtime'}
                        </span>
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                                totalPending > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                            }`}
                        >
                            <CloudOff className="w-3.5 h-3.5" />
                            {totalPending} chờ gửi
                        </span>
                        {failedCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-50 text-rose-700">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {failedCount} lỗi
                            </span>
                        )}
                    </div>
                    {lastSyncError && (
                        <p className="text-[11px] leading-relaxed text-rose-600 break-words">{lastSyncError}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <button
                            type="button"
                            onClick={handleSync}
                            disabled={busy || !isOnline}
                            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-xs font-bold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
                        >
                            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                            Đồng bộ ngay
                        </button>
                        <button
                            type="button"
                            onClick={handleDiscard}
                            disabled={busy || totalPending === 0}
                            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white text-xs font-bold text-rose-600 active:bg-rose-50 disabled:opacity-40"
                        >
                            <Trash2 className="w-4 h-4" />
                            Bỏ hàng đợi
                        </button>
                    </div>
                    {failedCount > 0 && (
                        <button
                            type="button"
                            onClick={handleRetryFailed}
                            disabled={busy}
                            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 text-xs font-bold text-amber-800 active:bg-amber-100 disabled:opacity-50"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Gửi lại {failedCount} thao tác lỗi
                        </button>
                    )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
                    {totalPending === 0 ? (
                        <div className="px-4 py-10 text-center">
                            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
                            <p className="mt-2 text-sm font-semibold text-slate-700">Đã đồng bộ xong</p>
                            <p className="mt-1 text-[11px] text-slate-500">Không còn thao tác nào chờ gửi lên server.</p>
                        </div>
                    ) : (
                        <>
                            {orders.length > 0 && (
                                <div className="px-4 py-2 bg-slate-50 text-[11px] font-bold text-slate-500">Đơn chờ gửi ({orders.length})</div>
                            )}
                            {orders.map((order) => (
                                <div key={order.id} className="px-4 py-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[13px] font-semibold text-slate-800 font-mono">{order.order_code}</p>
                                        <p className="text-[11px] text-slate-500">{formatTime(order.created_at)}</p>
                                    </div>
                                    <span className="text-[11px] font-mono font-bold text-slate-700">{order.total_amount?.toLocaleString('vi-VN')}</span>
                                </div>
                            ))}

                            {ops.length > 0 && (
                                <div className="px-4 py-2 bg-slate-50 text-[11px] font-bold text-slate-500">Nhập kho · Phiếu · Trả nợ ({ops.length})</div>
                            )}
                            {ops.map((op) => (
                                <div key={op.id} className="px-4 py-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[13px] font-semibold text-slate-800">{KIND_LABEL[op.kind]}</p>
                                        <p className="text-[11px] text-slate-500">{formatTime(op.created_at)}</p>
                                        {op.last_error && <p className="text-[11px] text-rose-600 break-words mt-0.5">{op.last_error}</p>}
                                    </div>
                                    <span
                                        className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${
                                            op.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                                        }`}
                                    >
                                        {op.status === 'failed' ? 'Lỗi' : 'Chờ'}
                                    </span>
                                </div>
                            ))}

                            {masters.length > 0 && (
                                <div className="px-4 py-2 bg-slate-50 text-[11px] font-bold text-slate-500">Danh mục chờ gửi ({masters.length})</div>
                            )}
                            {masters.map((m) => (
                                <div key={m.id} className="px-4 py-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[13px] font-semibold text-slate-800">
                                            {ENTITY_LABEL[m.entity]} · {m.operation === 'insert' ? 'Thêm' : m.operation === 'update' ? 'Sửa' : 'Xóa'}
                                        </p>
                                        <p className="text-[11px] text-slate-500">{formatTime(m.created_at)}</p>
                                        {m.last_error && <p className="text-[11px] text-rose-600 break-words mt-0.5">{m.last_error}</p>}
                                    </div>
                                    <span
                                        className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${
                                            m.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                                        }`}
                                    >
                                        {m.status === 'failed' ? 'Lỗi' : 'Chờ'}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
