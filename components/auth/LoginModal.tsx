'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import {
  X,
  LogIn,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  LogOut,
  UserRound,
  ShieldCheck,
} from 'lucide-react';

// Form đăng nhập nhân viên — mã NV (NV0001) hoặc email cũ + mật khẩu.
// UX: autofocus + Enter submit + ESC đóng + nhớ mã lần trước + báo CapsLock +
// thẻ phiên đang login (đổi tài khoản / đăng xuất) thay cho window.confirm ở header.
// locked=true: chế độ cổng bắt buộc (không có nút X, ESC/overlay không đóng).
const LAST_LOGIN_KEY = 'multipos_last_login';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  worker: 'Thợ',
};

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-rose-100 text-rose-700 border-rose-200',
  manager: 'bg-amber-100 text-amber-800 border-amber-200',
  cashier: 'bg-blue-100 text-blue-700 border-blue-200',
  worker: 'bg-slate-100 text-slate-600 border-slate-200',
};

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

  const handleSwitchAccount = async () => {
    await signOut();
    setPassword('');
    setError(null);
    // user -> null nên modal tự chuyển sang form; focus lại ô mã
    Promise.resolve().then(() => {
      idRef.current?.focus();
      idRef.current?.select();
    });
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
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-3"
      onClick={locked ? undefined : close}
    >
      <div
        id="login-modal-container"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Đăng nhập nhân viên"
      >
        {/* Cột brand — ẩn trên mobile */}
        <div className="hidden sm:flex w-40 shrink-0 flex-col justify-between bg-gradient-to-b from-slate-900 via-slate-900 to-blue-950 text-white p-4">
          <div>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center font-bold text-lg shadow">
              M
            </div>
            <div className="mt-2 font-bold text-sm leading-tight">MultiPOS</div>
            <div className="text-[10px] text-slate-400 leading-snug">Bán lẻ & Thi công<br />Nhôm kính</div>
          </div>
          <div className="space-y-1.5 text-[10px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Đúng người — đúng quyền</span>
            </div>
          </div>
        </div>

        {/* Cột form / phiên */}
        <div className="flex-1 min-w-0">
          <div className="px-4 pt-3.5 pb-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <LogIn className="w-4 h-4" />
              </span>
              {user ? 'Phiên đăng nhập' : 'Đăng nhập để vào làm việc'}
            </h3>
            {!locked && (
              <button
                onClick={close}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Đóng (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {user ? (
            /* Đã login: thẻ phiên + đổi/đăng xuất (thay window.confirm ở header) */
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="w-11 h-11 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-slate-900 truncate">{displayName}</div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">{user.email}</div>
                  {roleKey && (
                    <span
                      className={`inline-block mt-1 px-1.5 py-0.5 text-[10px] font-bold border rounded ${ROLE_BADGE[roleKey] || ROLE_BADGE.worker}`}
                    >
                      {ROLE_LABEL[roleKey] || roleKey}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleSwitchAccount}
                  className="h-9 px-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                  title="Đăng xuất tài khoản hiện tại và nhập tài khoản khác"
                >
                  <UserRound className="w-3.5 h-3.5" />
                  <span>Tài khoản khác</span>
                </button>
                <button
                  onClick={handleSignOut}
                  className="h-9 px-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                  title="Đăng xuất và đóng cửa sổ này"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Đăng xuất</span>
                </button>
              </div>
              <button
                onClick={close}
                className="w-full h-9 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Tiếp tục làm việc
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div>
                <label htmlFor="login-id-input" className="text-xs font-semibold text-slate-700">
                  Mã nhân viên <span className="font-normal text-slate-400">hoặc email cũ</span>
                </label>
                <input
                  ref={idRef}
                  id="login-id-input"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="VD: NV0001"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="mt-1 w-full h-10 px-3 text-sm font-mono font-bold tracking-wider bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="login-password-input" className="text-xs font-semibold text-slate-700">
                    Mật khẩu
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-blue-600 transition-colors"
                    title={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPw ? 'Ẩn' : 'Hiện'}</span>
                  </button>
                </div>
                <input
                  id="login-password-input"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={checkCaps}
                  onKeyDown={checkCaps}
                  placeholder="Phân biệt HOA / thường"
                  autoComplete="current-password"
                  className="mt-1 w-full h-10 px-3 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition"
                />
                {capsOn && (
                  <p className="mt-1 text-[11px] text-amber-700 font-medium">⚠️ Đang bật CapsLock — kiểm tra lại mật khẩu.</p>
                )}
              </div>
              {error && (
                <p id="login-error" className="flex items-start gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                  <span>{error}</span>
                </p>
              )}
              <button
                id="btn-login-submit"
                type="submit"
                disabled={busy || !loginId.trim() || !password}
                className="w-full h-10 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang đăng nhập...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Đăng nhập</span>
                  </>
                )}
              </button>
              <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                Mã NV được cấp khi vào làm (VD: NV0001).
                <br />
                Quên mật khẩu? Nhờ Admin đặt lại trong Cài đặt.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
