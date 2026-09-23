'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import {
  X,
  Eye,
  EyeOff,
  LoaderCircle,
  TriangleAlert,
  LogOut,
} from 'lucide-react';

// Form đăng nhập nhân viên — mã NV (VD: NV0001) hoặc email cũ + mật khẩu.
// Style: Google Account hiện đại, tối giản — card trắng bo 28px trên nền #f0f4f9,
// ô nhập viền floating-label, nút pill xanh #0b57d0.
// Logic: autofocus + Enter submit + ESC đóng + nhớ mã lần trước + báo CapsLock
// + thẻ phiên đang login (tiếp tục / đăng xuất).
// locked=true: chế độ cổng bắt buộc (không có nút X, ESC/overlay không đóng).
const LAST_LOGIN_KEY = 'multipos_last_login';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  worker: 'Thợ',
};

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-[#fce8e6] text-[#8c1d18]',
  manager: 'bg-[#fef7e0] text-[#7a4a00]',
  cashier: 'bg-[#e8f0fe] text-[#0b57d0]',
  worker: 'bg-[#f0f4f9] text-[#444746]',
};

function AppLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 512 512" aria-hidden="true" className="rounded-[10px]">
      <defs>
        <linearGradient id="multipos-login-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#multipos-login-g)" />
      <text x="256" y="348" fontFamily="Arial, sans-serif" fontSize="280" fontWeight="bold" fill="#ffffff" textAnchor="middle">M</text>
      <rect x="96" y="392" width="320" height="20" rx="10" fill="#34d399" />
    </svg>
  );
}

function GoogleField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  inputRef,
  onKeyDown,
  onKeyUp,
  spellCheck,
  autoCapitalize,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onKeyUp?: (e: React.KeyboardEvent) => void;
  spellCheck?: boolean;
  autoCapitalize?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        placeholder=" "
        className="peer w-full h-14 rounded-md border border-[#747775] bg-white px-4 pt-2 pr-11 text-[16px] text-[#1f1f1f] outline-none transition-colors placeholder-transparent hover:border-[#1f1f1f] focus:border-2 focus:border-[#0b57d0] focus:px-[15px] focus:pt-[7px]"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 bg-white px-1 text-[16px] text-[#444746] transition-all duration-150 peer-placeholder-shown:top-1/2 peer-placeholder-shown:text-[16px] peer-focus:top-0 peer-focus:text-[12px] peer-focus:text-[#0b57d0] peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[12px] peer-[:not(:placeholder-shown)]:text-[#444746]"
      >
        {label}
      </label>
      {trailing}
    </div>
  );
}

export function LoginModal({ locked = false }: { locked?: boolean }) {
  const { loginOpen, setLoginOpen, signIn, signOut, user, profile } = useStore();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);

  // Mỗi lần mở modal: nạp mã NV lần trước + focus ô nhập (defer microtask để khỏi set-state-in-effect)
  useEffect(() => {
    if (!loginOpen || user) return;
    Promise.resolve().then(() => {
      try {
        const last = localStorage.getItem(LAST_LOGIN_KEY);
        if (last) setLoginId(last);
      } catch {
        /* best-effort */
      }
      setError(null);
      setPassword('');
      setCapsOn(false);
      idRef.current?.focus();
      idRef.current?.select();
    });
  }, [loginOpen, user]);

  // ESC đóng modal (chế độ cổng bắt buộc thì giữ nguyên)
  useEffect(() => {
    if (!loginOpen || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLoginOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen, locked, setLoginOpen]);

  if (!loginOpen) return null;

  const close = () => {
    if (!busy && !locked) setLoginOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const id = loginId.trim();
    const err = await signIn(id, password);
    setBusy(false);
    if (err) {
      setError(err);
      idRef.current?.focus();
      idRef.current?.select();
    } else {
      try {
        localStorage.setItem(LAST_LOGIN_KEY, id);
      } catch {
        /* best-effort */
      }
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setLoginOpen(false);
  };

  const checkCaps = (e: React.KeyboardEvent) => {
    try {
      setCapsOn(!!e.getModifierState?.('CapsLock'));
    } catch {
      /* trình duyệt cũ */
    }
  };

  const displayName = profile?.full_name || user?.email || '';
  const roleKey = profile?.role || '';
  const initial = (displayName.trim()[0] || '?').toUpperCase();

  return (
    <div
      id="login-modal-overlay"
      className="fixed inset-0 z-50 flex min-h-dvh flex-col items-center justify-center bg-[#f0f4f9] p-4 font-sans antialiased"
      onClick={locked ? undefined : close}
      role="dialog"
      aria-modal="true"
      aria-label="Đăng nhập nhân viên"
    >
      <div
        id="login-modal-container"
        className="w-full max-w-[440px] rounded-[28px] bg-white px-6 py-8 sm:px-10 sm:py-9"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <AppLogo />
          {!locked && (
            <button
              type="button"
              onClick={close}
              aria-label="Đóng"
              title="Đóng (Esc)"
              className="rounded-full p-2 text-[#444746] transition-colors hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <h1 className="mt-4 text-[28px] font-normal leading-9 text-[#1f1f1f]">
          {user ? 'Xin chào' : 'Đăng nhập'}
        </h1>
        <p className="mt-1 text-[15px] leading-6 text-[#1f1f1f]">
          {user ? (
            <>để tiếp tục với phiên làm việc của bạn</>
          ) : (
            <>
              để tiếp tục sử dụng <span className="font-medium text-[#0b57d0]">MultiPOS</span>
            </>
          )}
        </p>

        {user ? (
          /* Đã login: thẻ phiên + tiếp tục/đăng xuất (thay window.confirm ở header) */
          <div className="mt-8 space-y-4">
            <div className="flex items-center gap-3 rounded-2xl border border-[#c4c7c5] p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0b57d0] text-lg font-medium text-white">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-[#1f1f1f]">{displayName}</div>
                <div className="truncate font-mono text-[12px] text-[#444746]">{user.email}</div>
                {roleKey && (
                  <span
                    className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${ROLE_BADGE[roleKey] || ROLE_BADGE.worker}`}
                  >
                    {ROLE_LABEL[roleKey] || roleKey}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={close}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#0b57d0] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#0842a0] hover:shadow-md"
                title="Tiếp tục làm việc"
              >
                <span>Tiếp tục</span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-[#747775] px-4 text-[14px] font-medium text-[#444746] transition-colors hover:bg-[#fce8e6] hover:text-[#8c1d18]"
                title="Đăng xuất và đóng cửa sổ này"
              >
                <LogOut className="h-4 w-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
            <div className="space-y-1.5">
              <GoogleField
                id="login-id-input"
                label="Mã nhân viên hoặc email"
                value={loginId}
                inputRef={idRef}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                onChange={setLoginId}
              />
              <p className="px-1 text-[13px] text-[#444746]">Ví dụ: NV0001 — tài khoản cũ vẫn dùng email được.</p>
            </div>

            <div className="space-y-1.5">
              <GoogleField
                id="login-password-input"
                label="Nhập mật khẩu của bạn"
                type={showPw ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                onChange={setPassword}
                onKeyDown={checkCaps}
                onKeyUp={checkCaps}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    title={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#444746] hover:bg-slate-100"
                  >
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                }
              />
              {capsOn && (
                <p className="px-1 text-[13px] font-medium text-[#7a4a00]">
                  Đang bật CapsLock — kiểm tra lại mật khẩu (phân biệt HOA / thường).
                </p>
              )}
            </div>

            {error && (
              <p
                id="login-error"
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-[#fce8e6] px-3 py-2.5 text-[13px] leading-5 text-[#8c1d18]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <div className="pt-1">
              <span className="rounded px-1 py-1 text-[14px] font-medium text-[#0b57d0]">
                Quên mật khẩu? Nhờ Admin đặt lại trong Cài đặt.
              </span>
            </div>

            <p className="text-[13px] leading-5 text-[#444746]">
              Không phải máy tính của bạn? Hãy đăng xuất sau khi xong việc. Mã NV được cấp khi vào làm.
            </p>

            <div className="flex items-center justify-end pt-3">
              <button
                id="btn-login-submit"
                type="submit"
                disabled={busy || !loginId.trim() || !password}
                className="flex h-10 min-w-[120px] items-center justify-center gap-2 rounded-full bg-[#0b57d0] px-6 text-[14px] font-medium text-white transition-colors hover:bg-[#0842a0] hover:shadow-md disabled:cursor-not-allowed disabled:bg-[#0b57d0]/40 disabled:shadow-none"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {busy ? 'Đang xử lý…' : 'Tiếp tục'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="mt-4 flex w-full max-w-[440px] items-center justify-between px-2 text-[12px] text-[#444746]">
        <span>Tiếng Việt</span>
        <div className="flex items-center gap-4">
          <span className="cursor-pointer hover:text-[#1f1f1f]">Trợ giúp</span>
          <span className="cursor-pointer hover:text-[#1f1f1f]">Quyền riêng tư</span>
          <span className="cursor-pointer hover:text-[#1f1f1f]">Điều khoản</span>
        </div>
      </div>
    </div>
  );
}
