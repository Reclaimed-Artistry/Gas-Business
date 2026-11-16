import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, getStoredToken, setStoredToken, subscribeToPlatformEvents } from '../lib/api';
import type { DispatcherProfile, NotificationItem, User } from '../types';

interface AuthContextValue {
  user: User | null;
  walletBalanceKobo: number;
  dispatcherProfile: DispatcherProfile | null;
  notifications: NotificationItem[];
  unreadNotifications: number;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [walletBalanceKobo, setWalletBalanceKobo] = useState(0);
  const [dispatcherProfile, setDispatcherProfile] = useState<DispatcherProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

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
        login,
        registerCustomer,
        logout,
        refreshAuth,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        setWalletBalanceKobo,
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
