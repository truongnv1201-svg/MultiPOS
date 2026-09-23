'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { X, LogIn } from 'lucide-react';

// Đăng nhập bằng Mã nhân viên + mật khẩu (VD: NV0001).
// Tài khoản cũ (email) vẫn đăng nhập được bằng email.
export function LoginModal() {
  const { loginOpen, setLoginOpen, signIn } = useStore();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loginOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(loginId, password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div id="login-modal-overlay" className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3">
      <div id="login-modal-container" className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <LogIn className="w-4 h-4 text-emerald-400" /> Đăng nhập nhân viên
          </h3>
          <button onClick={() => setLoginOpen(false)} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Mã nhân viên</label>
            <input
              id="login-id-input"
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value.toUpperCase())}
              placeholder="VD: NV0001"
              className="mt-1 w-full h-9 px-2.5 text-sm font-mono font-bold uppercase border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Mật khẩu (phân biệt HOA/thường)</label>
            <div className="relative mt-1">
              <input
                id="login-password-input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-9 px-2.5 pr-14 text-sm border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-1 top-1 h-7 px-2 text-[11px] font-bold text-slate-500 hover:text-blue-600"
              >
                {showPw ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>
          {error && (
            <p id="login-error" className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
              {error}
            </p>
          )}
          <button
            id="btn-login-submit"
            type="submit"
            disabled={busy}
            className="w-full h-9 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg"
          >
            {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            Mỗi nhân viên đăng nhập bằng mã NV + mật khẩu được cấp khi vào làm.
          </p>
        </form>
      </div>
    </div>
  );
}
