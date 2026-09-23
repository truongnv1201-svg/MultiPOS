'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { formatVND, formatNumber, handleMoneyInputChange } from '@/lib/format';
import { notify } from '@/components/common/Toast';
import {
  LogOut,
  X,
  AlertTriangle,
  CheckCircle2,
  Lock,
  WifiOff,
  RefreshCw,
  Banknote,
  Receipt,
  ArrowRight,
} from 'lucide-react';

export function ShiftModalF12() {
  const {
    shiftModalOpen,
    setShiftModalOpen,
    currentShift,
    closeShift,
    openNewShift,
    isOnline,
    pendingQueue,
    syncPendingOrders,
    user,
    profile,
    cashierName,
    supabaseReady,
    setLoginOpen,
  } = useStore();

  const [countedCash, setCountedCash] = useState<number>(currentShift.expected_cash || 0);
  const [newShiftStartingCash, setNewShiftStartingCash] = useState<number>(2000000);
  const [isClosing, setIsClosing] = useState<boolean>(false);

  if (!shiftModalOpen) return null;

  const needLogin = supabaseReady && !user;
  const isLocked = !isOnline || pendingQueue.length > 0 || needLogin;
  const isShiftOpen = currentShift.status === 'open';
  const cashDiff = countedCash - currentShift.expected_cash;
  // Ca đứng tên người khác: chỉ chủ ca hoặc Admin/Quản lý được kết (store cưỡng chế, modal báo trước)
  const isForeignShift = !!user && isShiftOpen && currentShift.cashier_name !== cashierName;
  const canOverrideShift = profile?.role === 'admin' || profile?.role === 'manager';
  const blockedForeign = isForeignShift && !canOverrideShift;

  const handleConfirmClose = async () => {
    if (needLogin) {
      alert('Vui lòng đăng nhập thu ngân trước khi kết ca!');
      setLoginOpen(true);
      return;
    }
    if (blockedForeign) {
      alert(
        `Ca này do "${currentShift.cashier_name}" mở — bạn (${cashierName}) không thể kết ca hộ. Nhờ đúng người hoặc Admin/Quản lý kết ca.`
      );
      return;
    }
    if (isLocked) {
      alert('LỖI OFF-ERR-01: Thiết bị đang Offline hoặc còn đơn hàng ngoại tuyến chưa đồng bộ!');
      return;
    }
    setIsClosing(true);
    try {
      const ok = await closeShift(countedCash);
      if (ok) {
        notify('Đóng ca làm việc thành công! Biên bản kết ca đã được khóa sổ vĩnh viễn.', 'success');
      }
    } finally {
      setIsClosing(false);
    }
  };

  const handleStartNewShift = async () => {
    if (needLogin) {
      alert('Vui lòng đăng nhập trước khi mở ca!');
      setLoginOpen(true);
      return;
    }
    await openNewShift(newShiftStartingCash);
    notify('Bắt đầu ca làm việc mới thành công!', 'success');
    setShiftModalOpen(false);
  };

  return (
    <div
      id="shift-modal-overlay"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3"
    >
      <div
        id="shift-modal-container"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[95vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 text-xs font-mono font-bold bg-amber-400 text-slate-900 rounded">
              F12
            </span>
            <h3 className="font-bold text-sm">
              {isShiftOpen ? 'KIỂM ĐẾM TIỀN KÉT & ĐÓNG CA LÀM VIỆC' : 'BẮT ĐẦU CA LÀM VIỆC MỚI'}
            </h3>
          </div>
          <button
            onClick={() => setShiftModalOpen(false)}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {needLogin && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">CHƯA ĐĂNG NHẬP THU NGÂN</div>
                <p className="leading-relaxed">
                  Vui lòng đăng nhập (tài khoản {profile?.full_name || 'thu ngân'}) trước khi mở/kết ca.
                </p>
                <button
                  onClick={() => {
                    setShiftModalOpen(false);
                    setLoginOpen(true);
                  }}
                  className="mt-1 px-3 py-1 bg-amber-600 text-white rounded text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  Đăng nhập ngay
                </button>
              </div>
            </div>
          )}
          {isShiftOpen ? (
            <>
              {/* Cảnh báo ca đứng tên người khác */}
              {isForeignShift && (
                <div
                  className={`p-3 border rounded-lg text-xs flex items-start gap-2.5 ${
                    canOverrideShift
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${canOverrideShift ? 'text-amber-600' : 'text-rose-600'}`} />
                  <div className="space-y-1">
                    <div className="font-bold">
                      {canOverrideShift ? 'KẾT CA HỘ (QUYỀN ADMIN/QUẢN LÝ)' : 'CA KHÔNG PHẢI CỦA BẠN'}
                    </div>
                    <p className="leading-relaxed">
                      Ca này do <strong>{currentShift.cashier_name}</strong> mở, bạn đang đăng nhập là{' '}
                      <strong>{cashierName}</strong>.{' '}
                      {canOverrideShift
                        ? 'Bạn có quyền kết ca hộ nhưng phải chịu trách nhiệm số liệu két.'
                        : 'Bạn không thể kết ca hộ — nhờ đúng người hoặc Admin/Quản lý kết ca rồi mở ca mới đứng tên bạn.'}
                    </p>
                  </div>
                </div>
              )}
              {/* OFF-ERR-01 Error Warning Banner if offline or pending queue > 0 */}
              {isLocked && !needLogin && (
                <div
                  id="off-err-01-banner"
                  className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold">
                      KHÓA ĐÓNG CA (OFF-ERR-01 BẢN VÁ BẤT BIẾN CA)
                    </div>
                    <p className="leading-relaxed">
                      {!isOnline
                        ? 'Thiết bị đang NGOẠI TUYẾN (Offline). Thu ngân phải kết nối lại mạng Internet trước khi kiểm đếm két.'
                        : `Còn ${pendingQueue.length} đơn hàng ngoại tuyến trên trình duyệt chưa đồng bộ về cơ sở dữ liệu máy chủ!`}
                    </p>
                    {isOnline && pendingQueue.length > 0 && (
                      <button
                        onClick={syncPendingOrders}
                        className="mt-1 px-3 py-1 bg-rose-600 text-white rounded text-xs font-semibold flex items-center gap-1 hover:bg-rose-700 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Đồng bộ ngay {pendingQueue.length} đơn hàng</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Shift Overview Metrics */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs space-y-2 font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Thu ngân trực ca:</span>
                  <span className="font-bold text-slate-900">
                    {currentShift.cashier_name}
                    {isForeignShift && <span className="font-normal text-rose-600"> (bạn: {cashierName})</span>}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Thời gian mở ca:</span>
                  <span>{new Date(currentShift.opened_at).toLocaleString('vi-VN')}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tiền mặt đầu ca:</span>
                  <span className="font-semibold text-slate-900">{formatVND(currentShift.starting_cash)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Doanh thu tiền mặt trong ca:</span>
                  <span className="font-semibold text-emerald-700">+{formatVND(currentShift.cash_sales)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tiền cọc nhận bằng tiền mặt:</span>
                  <span className="font-semibold text-amber-700">+{formatVND(currentShift.deposit_collected)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tiền chi từ két trong ca:</span>
                  <span className="font-semibold text-rose-700">-{formatVND(currentShift.cash_payouts)}</span>
                </div>
                <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-1.5">
                  <span>Doanh thu VietQR / Ngân hàng:</span>
                  <span className="font-semibold text-blue-700">{formatVND(currentShift.transfer_sales)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tổng số đơn đã phục vụ:</span>
                  <span className="font-bold text-slate-900">{currentShift.order_count} đơn</span>
                </div>
              </div>

              {/* Theoretical Expected Cash vs Actual Counted Cash */}
              <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">TIỀN MẶT LÝ THUYẾT PHẢI CÓ TRONG KÉT:</span>
                  <span className="font-mono font-extrabold text-base text-blue-800">
                    {formatVND(currentShift.expected_cash)}
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Tiền mặt thực tế đếm được trong két (Kiểm đếm cuối ca):
                  </label>
                  <input
                    type="text"
                    value={new Intl.NumberFormat('vi-VN').format(countedCash)}
                    onChange={(e) => {
                      handleMoneyInputChange(e, (num) => setCountedCash(num));
                    }}
                    disabled={isLocked}
                    className="w-full h-10 px-3 text-right font-mono font-bold text-lg text-slate-900 bg-white border border-blue-300 rounded-md focus:border-blue-600 focus:outline-hidden disabled:bg-slate-100"
                  />
                </div>

                {/* Cash Difference Indicator */}
                <div className="flex items-center justify-between pt-1 border-t border-blue-200 font-mono font-bold">
                  <span>Chênh lệch két tiền:</span>
                  {cashDiff === 0 ? (
                    <span className="text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      Khớp 100% (0 đ)
                    </span>
                  ) : cashDiff > 0 ? (
                    <span className="text-emerald-700 font-semibold">
                      Thừa +{formatVND(cashDiff)}
                    </span>
                  ) : (
                    <span className="text-rose-700 font-semibold">
                      Thiếu {formatVND(cashDiff)}
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            // Form to start a new shift
            <div className="space-y-4 text-xs">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800">
                <div className="font-bold mb-1">Ca làm việc trước đó đã đóng hoàn tất.</div>
                <p>Nhập số tiền mặt đầu ca để bàn giao két cho ca làm việc mới.</p>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  Tiền mặt đầu ca (Bàn giao két):
                </label>
                <input
                  type="text"
                  value={new Intl.NumberFormat('vi-VN').format(newShiftStartingCash)}
                  onChange={(e) => {
                    handleMoneyInputChange(e, (num) => setNewShiftStartingCash(num));
                  }}
                  className="w-full h-10 px-3 text-right font-mono font-bold text-lg text-slate-900 bg-white border border-slate-300 rounded-md focus:border-emerald-600 focus:outline-hidden"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={() => setShiftModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg"
          >
            Đóng (Esc)
          </button>

          {isShiftOpen ? (
            <button
              id="btn-confirm-close-shift"
              onClick={handleConfirmClose}
              disabled={isLocked || isClosing || blockedForeign}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{isClosing ? 'Đang khóa sổ ca...' : 'Xác nhận Đóng ca (F12)'}</span>
            </button>
          ) : (
            <button
              id="btn-confirm-open-shift"
              onClick={handleStartNewShift}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>Bắt đầu ca mới</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
