import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSession, signOut } from '../api/betterAuth';

const COOKIE_DOMAIN = '.zenjoymedia.media';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function setCookie(name: string, value: string) {
  const isLocalhost = window.location.hostname === 'localhost';
  const domain = isLocalhost ? '' : `; domain=${COOKIE_DOMAIN}`;
  const secure = isLocalhost ? '' : '; Secure';
  const sameSite = isLocalhost ? 'Lax' : 'None';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/${domain}; max-age=${COOKIE_MAX_AGE}; SameSite=${sameSite}${secure}`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function deleteCookie(name: string) {
  const isLocalhost = window.location.hostname === 'localhost';
  const domain = isLocalhost ? '' : `; domain=${COOKIE_DOMAIN}`;
  document.cookie = `${name}=; path=/${domain}; max-age=0`;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  feishu_user_id?: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  login: (user: User, token?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true';
const MOCK_EMAIL = import.meta.env.VITE_MOCK_USER_EMAIL || 'staff@test.com';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (SKIP_AUTH) {
      setUser({
        id: 'mock-staff-user',
        name: 'Staff Mock User',
        email: MOCK_EMAIL,
      });
      setAuthLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled) return;
      if (session?.user) {
        const nextUser = {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
        };
        setUser(nextUser);
        setCookie('user', JSON.stringify(nextUser));
        setCookie('token', 'better-auth-session');
        setAuthLoading(false);
        return;
      }

      const savedUser = getCookie('user');
      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser) as User);
        } catch {
          deleteCookie('user');
          deleteCookie('token');
        }
      }
      setAuthLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = (nextUser: User, token = 'better-auth-session') => {
    setUser(nextUser);
    setCookie('user', JSON.stringify(nextUser));
    setCookie('token', token);
  };

  const logout = () => {
    setUser(null);
    deleteCookie('user');
    deleteCookie('token');
    void signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, authLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
