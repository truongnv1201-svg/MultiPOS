'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { toast, confirmDialog } from '@/lib/notify';
import { VIETQR_BANKS, isVietqrReady, buildVietqrUrl } from '@/lib/vietqr';
import { PRINT_TEMPLATES } from '@/lib/store';
import type { PrintTemplate, PrinterWidth } from '@/lib/store';
import {
  Settings,
  RotateCcw,
  Store,
  Wifi,
  WifiOff,
  Cpu,
  QrCode,
  Hammer,
  Coins,
  Lock,
  Printer,
  Receipt,
  ShoppingCart,
  Check,
  FileText,
  Copy,
  Type,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

export function SettingsView() {
  const {
    isOnline,
    toggleOnline,
    pendingQueue,
    resetData,
    shop,
    updateShop,
    vietqr,
    updateVietqr,
    grindingServices,
    updateGrindingPrice,
    cashRounding,
    updateCashRounding,
    user,
    profile,
    setLoginOpen,
  } = useStore();

  const isAdmin = profile?.role === 'admin';
  // Mọi việc nhân sự (tài khoản, phân quyền, hồ sơ, công, lương) làm ở trang Quản lý nhân sự.
  const [grindingDraft, setGrindingDraft] = useState<Record<string, string>>({});
  const [grindingMsg, setGrindingMsg] = useState<string | null>(null);
  const [roundingDraft, setRoundingDraft] = useState<string>('');
  const [roundingMsg, setRoundingMsg] = useState<string | null>(null);

  const handleSaveGrinding = async (id: string) => {
    const raw = (grindingDraft[id] ?? '').replace(/[^\d]/g, '');
    if (raw === '') {
      setGrindingMsg('Nhập đơn giá (đ/md) trước khi lưu.');
      return;
    }
    const err = await updateGrindingPrice(id, parseInt(raw, 10));
    setGrindingMsg(err ? `Lỗi: ${err}` : `Đã lưu giá mài ${id}.`);
    if (!err) {
      setGrindingDraft((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleSaveRounding = async () => {
    const err = await updateCashRounding(parseInt(roundingDraft, 10));
    setRoundingMsg(err ? `Lỗi: ${err}` : 'Đã lưu mệnh giá làm tròn.');
  };

  return (
    <div id="settings-view" className="flex-1 flex flex-col h-[calc(100vh-56px)] bg-slate-100 overflow-hidden">
      {/* Header */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          <span>Cài đặt Hệ thống</span>
        </h2>
        {!user && (
          <button
            onClick={() => setLoginOpen(true)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
            title="Đăng nhập để quản lý nhân viên / đổi cấu hình"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Đăng nhập</span>
          </button>
        )}
        {user && !isAdmin && (
          <span className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>{profile?.role === 'manager' ? 'Quản lý cửa hàng — cấu hình hệ thống chỉ Admin' : `Đã login (${profile?.role || '...'}) — cấu hình hệ thống chỉ Admin`}</span>
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 1. Store info (mở rộng) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-4 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Store className="w-4 h-4 text-blue-600" />
            <span>Thông tin cửa hàng (in lên đầu mọi phiếu)</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Tên cửa hàng">
              <input
                type="text"
                value={shop.name}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ name: e.target.value })}
                className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
            <Field label="Hotline / Zalo">
              <input
                type="text"
                value={shop.hotline}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ hotline: e.target.value })}
                className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
            <Field label="Địa chỉ">
              <input
                type="text"
                value={shop.address}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ address: e.target.value })}
                className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Mã số thuế (A4)">
                <input
                  type="text"
                  value={shop.taxCode || ''}
                  disabled={!isAdmin}
                  onChange={(e) => updateShop({ taxCode: e.target.value })}
                  placeholder="VD: 0312345678"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono disabled:bg-slate-50 disabled:text-slate-400"
                />
              </Field>
              <Field label="Email">
                <input
                  type="text"
                  value={shop.email || ''}
                  disabled={!isAdmin}
                  onChange={(e) => updateShop({ email: e.target.value })}
                  placeholder="shop@email.com"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
                />
              </Field>
            </div>
            <Field label="Lời cảm ơn cuối phiếu">
              <input
                type="text"
                value={shop.footerThanks || ''}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ footerThanks: e.target.value })}
                className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
            <Field label="Chính sách đổi trả (in nhỏ cuối phiếu)">
              <input
                type="text"
                value={shop.receiptPolicy || ''}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ receiptPolicy: e.target.value })}
                className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
          </div>
          <p className="text-[11px] text-slate-400">Lưu tự động theo từng máy trạm (không cần nút Lưu).</p>
        </div>

        {/* 2. Trung tâm in ấn */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-4 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Printer className="w-4 h-4 text-indigo-600" />
            <span>Trung tâm in ấn — mẫu phiếu & tùy chọn bản in</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
            {/* Mẫu phiếu — khổ giấy gắn liền theo mẫu, chỉ chọn 1 nơi */}
            <div>
              <p className="font-bold text-slate-800 mb-0.5">Mẫu phiếu mặc định</p>
              <p className="text-[11px] text-slate-400 mb-2">Mỗi mẫu đã gắn khổ giấy chuẩn (badge) — chọn mẫu là xong, lúc in vẫn đổi nhanh được.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {PRINT_TEMPLATES.map((t) => {
                  const active = shop.printTemplate === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => updateShop({ printTemplate: t.id as PrintTemplate, printerWidth: t.paper as PrinterWidth })}
                      className={`relative text-left rounded-xl border-2 p-3 transition-all disabled:opacity-60 overflow-hidden ${
                        active
                          ? 'border-blue-600 bg-blue-50/60 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-xs'
                      }`}
                    >
                      {active && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </span>
                      )}
                      <div className="flex items-end gap-2.5">
                        {/* Hình khổ giấy minh họa */}
                        <span className={`shrink-0 rounded-[3px] border-2 ${active ? 'border-blue-500 bg-white' : 'border-slate-300 bg-slate-50'} flex items-center justify-center text-slate-400`}
                          style={{
                            width: t.paper === '80mm' ? 26 : t.paper === 'A5' ? 32 : 36,
                            height: t.paper === '80mm' ? 44 : t.paper === 'A5' ? 40 : 46,
                          }}
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className={`font-bold leading-tight ${active ? 'text-blue-800' : 'text-slate-700'}`}>{t.label}</p>
                          <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                            {t.paper}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500 leading-snug">{t.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {/* Tùy chọn bản in (không còn chọn khổ giấy riêng — khổ ăn theo mẫu) */}
            <div>
              <p className="font-bold text-slate-800 mb-2">Tùy chọn bản in</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                    <Type className="w-3.5 h-3.5 text-indigo-600" /> Cỡ chữ phiếu
                  </p>
                  <div className="flex gap-1">
                    {[
                      { v: 'small' as const, label: 'Nhỏ', cls: 'text-[10px]' },
                      { v: 'medium' as const, label: 'Vừa', cls: 'text-xs' },
                      { v: 'large' as const, label: 'Lớn', cls: 'text-sm' },
                    ].map((o) => (
                      <Button
                        key={o.v}
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => updateShop({ fontSize: o.v })}
                        variant={shop.fontSize === o.v ? 'primary' : 'secondary'}
                        className={`flex-1 ${o.cls}`}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-400">Chữ nhỏ giúp tiết kiệm giấy nhiệt.</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                    <Copy className="w-3.5 h-3.5 text-indigo-600" /> Số liên in
                  </p>
                  <div className="flex gap-1">
                    {[1, 2, 3].map((n) => (
                      <Button
                        key={n}
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => updateShop({ printCopies: n })}
                        variant={(shop.printCopies ?? 1) === n ? 'primary' : 'secondary'}
                        className="flex-1"
                      >
                        {n} liên
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-400">2 liên: khách + quầy • 3 liên: + kế toán.</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3.5 h-3.5 text-indigo-600" /> In tự động
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!shop.autoPrint}
                    disabled={!isAdmin}
                    onClick={() => updateShop({ autoPrint: !shop.autoPrint })}
                    className={`w-full h-8 rounded-md border font-bold text-xs flex items-center justify-between px-2.5 transition-colors disabled:opacity-50 ${shop.autoPrint ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white text-slate-500 border-slate-300'}`}
                  >
                    <span>{shop.autoPrint ? 'Bật — mở phiếu sau bán' : 'Tắt'}</span>
                    <span className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${shop.autoPrint ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${shop.autoPrint ? 'translate-x-4' : ''}`} />
                    </span>
                  </button>
                  <p className="mt-1.5 text-[10px] text-slate-400">Tự mở phiếu để bấm In sau thanh toán.</p>
                </div>
              </div>
            </div>
        </div>

        {/* 3. Nội dung hiển thị trên phiếu */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Receipt className="w-4 h-4 text-emerald-600" />
            <span>Nội dung hiển thị trên phiếu in</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { key: 'showLogo' as const, label: 'Logo / tên nổi bật' },
              { key: 'showCashier' as const, label: 'Tên thu ngân + ca' },
              { key: 'showCustomerPhone' as const, label: 'SĐT khách hàng' },
              { key: 'showVietqr' as const, label: 'Mã VietQR' },
              { key: 'showDimensions' as const, label: 'Chi tiết tấm cắt (m²)' },
              { key: 'showDebt' as const, label: 'Dòng công nợ còn lại' },
            ].map((opt) => (
              <label
                key={opt.key}
                className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded px-2.5 py-2 cursor-pointer hover:bg-slate-100"
              >
                <input
                  type="checkbox"
                  checked={!!(shop as any)[opt.key]}
                  disabled={!isAdmin}
                  onChange={(e) => updateShop({ [opt.key]: e.target.checked } as any)}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="font-medium text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 4. Mặc định bán hàng POS */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <ShoppingCart className="w-4 h-4 text-amber-600" />
            <span>Mặc định bán hàng (áp dụng cho hóa đơn mới)</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">VAT mặc định</label>
              <div className="flex gap-1">
                {[0, 8, 10].map((v) => (
                  <Button
                    key={v}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => updateShop({ defaultVat: v as any })}
                    variant={shop.defaultVat === v ? 'primary' : 'secondary'}
                    className="flex-1"
                  >
                    {v}%
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Thanh toán mặc định</label>
              <select
                value={shop.defaultPayment}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ defaultPayment: e.target.value as any })}
                className="w-full h-8 px-2 border border-slate-300 rounded font-medium disabled:bg-slate-50"
              >
                <option value="cash">Tiền mặt</option>
                <option value="transfer">VietQR chuyển khoản</option>
                <option value="card">Quẹt thẻ</option>
                <option value="debt">Ghi nợ</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Bảng giá mặc định</label>
              <select
                value={shop.defaultPriceBook}
                disabled={!isAdmin}
                onChange={(e) => updateShop({ defaultPriceBook: e.target.value as any })}
                className="w-full h-8 px-2 border border-slate-300 rounded font-medium disabled:bg-slate-50"
              >
                <option value="retail">Giá lẻ</option>
                <option value="trade">Giá thợ / đại lý</option>
              </select>
            </div>
          </div>
        </div>

        {/* VietQR */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-4 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <QrCode className="w-4 h-4 text-blue-600" />
            <span>Tài khoản VietQR (hiện mã QR thật ở POS & phiếu in)</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Ngân hàng">
              <select
                value={vietqr.bank}
                disabled={!isAdmin}
                onChange={(e) => updateVietqr({ bank: e.target.value })}
                className="w-full h-8 px-2 border border-slate-300 rounded font-medium disabled:bg-slate-50"
              >
                <option value="">-- Chọn ngân hàng --</option>
                {VIETQR_BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Số tài khoản (chỉ số)">
              <input
                type="text"
                inputMode="numeric"
                value={vietqr.account}
                disabled={!isAdmin}
                onChange={(e) => updateVietqr({ account: e.target.value.replace(/[^\d]/g, '').slice(0, 19) })}
                placeholder="VD: 0901234567"
                className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
            <Field label="Tên chủ tài khoản">
              <input
                type="text"
                value={vietqr.name}
                disabled={!isAdmin}
                onChange={(e) => updateVietqr({ name: e.target.value })}
                placeholder="VD: NGUYEN VAN A"
                className="w-full h-8 px-2.5 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
              {isVietqrReady(vietqr) ? (
                <>
                  {/* QR mẫu từ img.vietqr.io (ảnh ngoài, đổi theo cấu hình) — next/image không phù hợp: giữ <img>. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={buildVietqrUrl(vietqr)}
                  alt="VietQR mẫu"
                  className="w-24 h-24 border border-slate-200 rounded object-contain"
                />
                <p className="text-[11px] text-emerald-700 font-semibold">
                  Hợp lệ — mã QR thật (số tiền động theo đơn) sẽ hiện ở màn hình thu tiền & phiếu in.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-amber-700">
                Chưa đủ thông tin — POS sẽ hiện khung chờ thay vì mã QR giả.
              </p>
            )}
          </div>
        </div>

        {/* Grinding prices (admin) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Hammer className="w-4 h-4 text-amber-600" />
            <span>Đơn giá công mài (đ/mét dài) — áp dụng ngay cho Modal F3</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
          <div className="divide-y divide-slate-100">
            {grindingServices.map((g) => (
              <div key={g.id} className="py-2 flex items-center gap-2">
                <span className="flex-1 font-medium text-slate-700">{g.label}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={!isAdmin}
                  value={grindingDraft[g.id] ?? new Intl.NumberFormat('vi-VN').format(g.price_per_md)}
                  onChange={(e) =>
                    setGrindingDraft((prev) => ({ ...prev, [g.id]: e.target.value.replace(/[^\d]/g, '') }))
                  }
                  className="w-32 h-8 px-2 text-right font-mono border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
                />
                <span className="text-slate-400 w-12">đ/md</span>
                <Button
                  disabled={!isAdmin}
                  onClick={() => handleSaveGrinding(g.id)}
                  variant="primary"
                >
                  Lưu
                </Button>
              </div>
            ))}
          </div>
          {grindingMsg && (
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">{grindingMsg}</p>
          )}
        </div>

        {/* Cash rounding (admin) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3 text-xs">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Coins className="w-4 h-4 text-emerald-600" />
            <span>Làm tròn tiền mặt (chỉ khi thu tiền mặt)</span>
            {!isAdmin && (
              <span className="ml-auto text-[11px] text-slate-400 font-normal flex items-center gap-1">
                <Lock className="w-3 h-3" /> Chỉ Admin được đổi
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">
              Mệnh giá hiện tại: <strong className="font-mono tnum">{new Intl.NumberFormat('vi-VN').format(cashRounding)}đ</strong>
            </span>
            <select
              disabled={!isAdmin}
              value={roundingDraft || String(cashRounding)}
              onChange={(e) => setRoundingDraft(e.target.value)}
              className="h-8 px-2 border border-slate-300 rounded font-medium disabled:bg-slate-50"
            >
              {[100, 500, 1000, 5000].map((d) => (
                <option key={d} value={d}>
                  {new Intl.NumberFormat('vi-VN').format(d)}đ
                </option>
              ))}
            </select>
            <Button
              disabled={!isAdmin}
              onClick={handleSaveRounding}
              variant="primary"
            >
              Lưu
            </Button>
          </div>
          {roundingMsg && (
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">{roundingMsg}</p>
          )}
        </div>

        {/* Offline Simulator & Reset */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-600" />
              <span>Mô Phỏng Trạng Thái Mạng & Đồng Bộ Ngoại Tuyến (Dexie IndexedDB)</span>
            </h3>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span>Trạng thái kết nối hiện tại:</span>
                <span className={`font-bold flex items-center gap-1.5 ${isOnline ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  {isOnline ? 'ONLINE (Đang trực tuyến)' : 'OFFLINE (Ngoại tuyến mô phỏng)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Hàng đợi đơn chờ đồng bộ:</span>
                <span className="font-mono font-bold text-slate-900">{pendingQueue.length} đơn</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleOnline}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                  isOnline
                    ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {isOnline ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
                <span>{isOnline ? 'Chuyển sang Offline (Kiểm tra lưu Dexie)' : 'Khôi phục Online (Tự động sync)'}</span>
              </button>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-rose-600" />
              <span>Xóa dữ liệu máy trạm này (IndexedDB)</span>
            </h3>
            <p className="text-xs text-slate-600">
              Xóa cache máy này và nạp lại danh mục từ server. Không ảnh hưởng dữ liệu máy chủ.
            </p>
            <Button
              onClick={async () => {
                if (await confirmDialog('Xóa toàn bộ dữ liệu lưu trên máy trạm này?', { danger: true })) {
                  resetData();
                  toast('Đã xóa dữ liệu máy trạm!', 'success');
                }
              }}
              variant="outline-danger"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Xóa dữ liệu máy trạm</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
