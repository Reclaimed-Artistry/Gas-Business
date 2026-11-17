import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest, getStoredToken, setStoredToken, subscribeToPlatformEvents } from '../lib/api';
import { getSupabaseBrowserClient, isSupabaseClientConfigured } from '../lib/supabase';
import type { DispatcherProfile, NotificationItem, User } from '../types';

const OAUTH_REDIRECT_KEY = 'blueflame_oauth_redirect';

interface AuthContextValue {
  user: User | null;
  walletBalanceKobo: number;
  dispatcherProfile: DispatcherProfile | null;
  notifications: NotificationItem[];
  unreadNotifications: number;
  loading: boolean;
  oauthLoading: boolean;
  oauthError: string | null;
  googleAuthAvailable: boolean;
  login: (email: string, password: string) => Promise<User>;
  loginWithGoogle: (redirectAfter?: string) => Promise<void>;
  registerCustomer: (data: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  setWalletBalanceKobo: React.Dispatch<React.SetStateAction<number>>;
  consumeOAuthRedirect: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [walletBalanceKobo, setWalletBalanceKobo] = useState(0);
  const [dispatcherProfile, setDispatcherProfile] = useState<DispatcherProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loading, setLoading] = useState(true);
  const callbackRef = useRef(Boolean(new URLSearchParams(window.location.search).get('code') || new URLSearchParams(window.location.hash.slice(1)).get('access_token') || new URLSearchParams(window.location.hash.slice(1)).get('error')));
  const [oauthLoading, setOauthLoading] = useState(callbackRef.current);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [googleAuthAvailable, setGoogleAuthAvailable] = useState(isSupabaseClientConfigured());
  const exchangingRef = useRef(false);

  const refreshNotifications = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const res = await apiRequest<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/api/auth/notifications'
      );
      setNotifications(res.notifications);
      setUnreadNotifications(res.unreadCount);
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  const exchangeSupabaseToken = useCallback(
    async (accessToken: string): Promise<User | null> => {
      if (exchangingRef.current) return null;
      exchangingRef.current = true;
      setOauthLoading(true);
      setOauthError(null);
      try {
        const res = await apiRequest<{
          user: User;
          token: string;
          walletBalanceKobo?: number;
          dispatcherProfile?: DispatcherProfile | null;
        }>('/api/auth/supabase-exchange', {
          method: 'POST',
          body: { accessToken },
        });
        callbackRef.current = false;
        setStoredToken(res.token);
        setUser(res.user);
        setWalletBalanceKobo(res.walletBalanceKobo ?? 0);
        setDispatcherProfile(res.dispatcherProfile ?? null);
        void refreshNotifications();

        // Clean OAuth parameters from URL cleanly
        if (window.location.search.includes('code=') || window.location.hash.includes('access_token=')) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        return res.user;
      } catch (err) {
        setOauthError((err as Error).message || 'Could not complete Google sign-in.');
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          await supabase.auth.signOut().catch(() => {});
        }
        return null;
      } finally {
        exchangingRef.current = false;
        setOauthLoading(false);
      }
    },
    [refreshNotifications]
  );

  const refreshAuth = useCallback(async () => {
    if (!getStoredToken()) {
      setUser(null);
      setWalletBalanceKobo(0);
      setDispatcherProfile(null);
      setNotifications([]);
      setUnreadNotifications(0);
      setLoading(false);
      return;
    }
    try {
      const res = await apiRequest<{
        user: User;
        walletBalanceKobo?: number;
        dispatcherProfile?: DispatcherProfile | null;
        unreadNotifications: number;
      }>('/api/auth/me');
      setUser(res.user);
      setWalletBalanceKobo(res.walletBalanceKobo ?? 0);
      setDispatcherProfile(res.dispatcherProfile ?? null);
      setUnreadNotifications(res.unreadNotifications ?? 0);
      void refreshNotifications();
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [refreshNotifications]);

  // Verify backend Google Auth capability on mount
  useEffect(() => {
    apiRequest<{ googleAuthEnabled: boolean }>('/api/auth/config')
      .then((cfg) => {
        setGoogleAuthAvailable(Boolean(cfg.googleAuthEnabled && isSupabaseClientConfigured()));
      })
      .catch(() => {
        setGoogleAuthAvailable(isSupabaseClientConfigured());
      });
  }, []);

  // Supabase handles the PKCE callback during client initialization. Do not let
  // an existing Gasflo session redirect away before this exchange completes.
  useEffect(() => {
    const isCallback = callbackRef.current;
    if (!isCallback) void refreshAuth();
    else setLoading(false);

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const oauthFailure = hash.get('error_description') || hash.get('error');
    if (oauthFailure) {
      setOauthError(`Google sign-in failed: ${oauthFailure}`);
      setOauthLoading(false);
      callbackRef.current = false;
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      if (isCallback) {
        setOauthError('Google sign-in is not configured in this environment.');
        setOauthLoading(false);
      }
      return;
    }
    const shouldExchange = () => isCallback || !getStoredToken();
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.access_token && shouldExchange()) {
        void exchangeSupabaseToken(session.access_token);
      }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (data.session?.access_token && shouldExchange()) {
        void exchangeSupabaseToken(data.session.access_token);
      } else if (isCallback && !data.session && !exchangingRef.current) {
        setOauthError(error?.message || 'Google sign-in could not be completed. Please try again in the same browser.');
        setOauthLoading(false);
        callbackRef.current = false;
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }).catch(() => {
      if (isCallback) {
        setOauthError('Could not complete Google sign-in. Please try again.');
        setOauthLoading(false);
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, [refreshAuth, exchangeSupabaseToken]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToPlatformEvents({
      onNotification: () => {
        void refreshNotifications();
      },
      onOrderUpdate: () => {
        void refreshNotifications();
      },
    });
    return unsubscribe;
  }, [user, refreshNotifications]);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await apiRequest<{
      user: User;
      token: string;
      walletBalanceKobo?: number;
      dispatcherProfile?: DispatcherProfile | null;
    }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setStoredToken(res.token);
    setUser(res.user);
    setWalletBalanceKobo(res.walletBalanceKobo ?? 0);
    setDispatcherProfile(res.dispatcherProfile ?? null);
    void refreshNotifications();
    return res.user;
  };

  const loginWithGoogle = async (redirectAfter?: string): Promise<void> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      throw new Error('Google sign-in is not configured in this environment.');
    }
    setOauthError(null);
    setOauthLoading(true);
    try {
      if (redirectAfter) {
        sessionStorage.setItem(OAUTH_REDIRECT_KEY, redirectAfter);
      } else {
        sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/login`,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error) {
        setOauthLoading(false);
        throw new Error(error.message);
      }
    } catch (err) {
      setOauthLoading(false);
      throw err;
    }
  };

  const consumeOAuthRedirect = (): string | null => {
    try {
      const target = sessionStorage.getItem(OAUTH_REDIRECT_KEY);
      if (target) sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
      return target;
    } catch {
      return null;
    }
  };

  const registerCustomer = async (data: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  }): Promise<User> => {
    const res = await apiRequest<{ user: User; token: string; walletBalanceKobo: number }>('/api/auth/register', {
      method: 'POST',
      body: data,
    });
    setStoredToken(res.token);
    setUser(res.user);
    setWalletBalanceKobo(res.walletBalanceKobo ?? 0);
    setDispatcherProfile(null);
    void refreshNotifications();
    return res.user;
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    setStoredToken(null);
    setUser(null);
    setWalletBalanceKobo(0);
    setDispatcherProfile(null);
    setNotifications([]);
    setUnreadNotifications(0);
  };

  const markNotificationRead = async (id: number) => {
    await apiRequest(`/api/auth/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
    setUnreadNotifications((prev) => Math.max(0, prev - 1));
  };

  const markAllNotificationsRead = async () => {
    await apiRequest('/api/auth/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setUnreadNotifications(0);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        walletBalanceKobo,
        dispatcherProfile,
        notifications,
        unreadNotifications,
        loading,
        oauthLoading,
        oauthError,
        googleAuthAvailable,
        login,
        loginWithGoogle,
        registerCustomer,
        logout,
        refreshAuth,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        setWalletBalanceKobo,
        consumeOAuthRedirect,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
