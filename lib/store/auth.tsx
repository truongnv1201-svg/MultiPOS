// P3-phần 2: slice Auth — Supabase browser client, session, profile, login.
// Không phụ thuộc slice nào khác; Commerce và Store chính consume slice này.
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createSupabaseBrowserClient } from '../supabase/client';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { normalizeLoginId } from '../hrm';
import { vietnamizeError } from '../error-vi';

export interface AuthSlice {
  supa: SupabaseClient | null;
  supabaseReady: boolean;
  user: User | null;
  profile: { full_name: string; role: string; branch_id?: string | null } | null;
  authReady: boolean;
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
  signIn: (loginId: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthSlice | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // P3: Supabase browser client (null khi chưa cấu hình env -> chạy local-only).
  // Khởi tạo null ở cả server lẫn client lần đầu render để tránh hydration mismatch
  // (server luôn null; client chỉ tạo sau mount). supabaseReady=false ở lần render đầu hai phía.
  const [supa, setSupa] = useState<SupabaseClient | null>(null);
  useEffect(() => {
    // Chạy trong microtask (idiom chung) để tránh set-state-in-effect sync:
    // vẫn giữ semantics cũ — server render null, client chỉ tạo sau mount (không hydration mismatch).
    Promise.resolve().then(() => {
      try {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
        setSupa(createSupabaseBrowserClient());
      } catch {
        /* local-only */
      }
    });
  }, []);
  const supabaseReady = supa !== null;

  // P6: Auth session + profile (role cho RBAC/RLS authenticated)
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ full_name: string; role: string; branch_id?: string | null } | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [loginOpen, setLoginOpen] = useState<boolean>(false);

  const loadProfile = useCallback(
    async (uid: string) => {
      if (!supa) return;
      try {
        const { data } = await supa.from('profiles').select('full_name, role, branch_id').eq('id', uid).maybeSingle();
        if (data) setProfile({ full_name: (data as any).full_name, role: (data as any).role, branch_id: (data as any).branch_id });
        else setProfile(null);
      } catch {
        setProfile(null);
      }
    },
    [supa]
  );

  useEffect(() => {
    if (!supa) {
      // Defer khỏi body effect để tránh cascading renders (set-state-in-effect)
      Promise.resolve().then(() => setAuthReady(true));
      return;
    }
    supa.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadProfile(data.session.user.id);
      setAuthReady(true);
    });
    const { data: sub } = supa.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [supa, loadProfile]);

  const signIn = useCallback(
    async (loginId: string, password: string): Promise<string | null> => {
      if (!supa) return 'Chưa cấu hình Supabase (thiếu env).';
      const cleanEmail = normalizeLoginId(loginId);
      const cleanPw = password.trim();
      if (!loginId.trim() || !cleanPw) return 'Vui lòng nhập đủ mã nhân viên và mật khẩu.';
      const { error } = await supa.auth.signInWithPassword({ email: cleanEmail, password: cleanPw });
      if (error) {
        const msg = error.message || '';
        if (/invalid login credentials/i.test(msg))
          return 'Sai mã nhân viên hoặc mật khẩu (mật khẩu phân biệt HOA/thường). VD mã: NV0001.';
        if (/email not confirmed/i.test(msg)) return 'Tài khoản chưa kích hoạt — liên hệ quản lý.';
        if (/too many requests|rate limit/i.test(msg)) return 'Thử quá nhiều lần — đợi 1 phút rồi thử lại.';
        return `Đăng nhập thất bại: ${vietnamizeError(error)}`;
      }
      setLoginOpen(false);
      return null;
    },
    [supa]
  );

  const signOut = useCallback(async () => {
    if (supa) await supa.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supa]);

  const value: AuthSlice = {
    supa,
    supabaseReady,
    user,
    profile,
    authReady,
    loginOpen,
    setLoginOpen,
    signIn,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthSlice {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
