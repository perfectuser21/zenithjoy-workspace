import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import { getSession, signOut as betterAuthSignOut } from '../api/better-auth.api';

// Cookie 工具函数 - 跨子域名共享
const COOKIE_DOMAIN = '.zenjoymedia.media';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

function setCookie(name: string, value: string) {
  const isLocalhost = window.location.hostname === 'localhost';
  const domain = isLocalhost ? '' : `; domain=${COOKIE_DOMAIN}`;
  const secure = isLocalhost ? '' : '; Secure';
  // SameSite=None 允许跨子域名共享（需要 Secure）
  const sameSite = isLocalhost ? 'Lax' : 'None';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/${domain}; max-age=${COOKIE_MAX_AGE}; SameSite=${sameSite}${secure}`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function deleteCookie(name: string) {
  const isLocalhost = window.location.hostname === 'localhost';
  const domain = isLocalhost ? '' : `; domain=${COOKIE_DOMAIN}`;
  document.cookie = `${name}=; path=/${domain}; max-age=0`;
}

interface User {
  id: string;
  feishu_user_id?: string;
  name: string;
  avatar?: string;
  email?: string;
  department?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isStaff: boolean;
  authLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 开发模式配置
const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true';
const MOCK_USER: User | null = SKIP_AUTH ? {
  id: import.meta.env.VITE_MOCK_USER_ID || 'dev-user-001',
  name: import.meta.env.VITE_MOCK_USER_NAME || '开发者',
  avatar: import.meta.env.VITE_MOCK_USER_AVATAR || 'https://api.dicebear.com/7.x/avataaars/svg?seed=dev',
  email: 'dev@zenjoymedia.media',
} : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 初始化时按优先级解析用户身份：
  //   1. 开发模式 mock
  //   2. better-auth session（PR-3）— GET /api/auth/get-session 携带 cookie
  //   3. 飞书 cookie（保留双轨）
  //   4. localStorage 迁移
  useEffect(() => {
    // 开发模式：跳过登录，直接使用 mock 用户
    if (SKIP_AUTH && MOCK_USER) {
      console.log('🔧 开发模式：跳过登录，使用 mock 用户');
      setUser(MOCK_USER);
      setToken('dev-token-mock');
      setAuthLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      // 步骤 1：尝试 better-auth session（cookie HttpOnly，前端用 fetch credentials:'include' 验证）
      try {
        const sess = await getSession();
        if (!cancelled && sess && sess.user) {
          const ba: User = {
            id: sess.user.id,
            name: sess.user.name,
            email: sess.user.email,
            // better-auth 不写 feishu_user_id；isSuperAdmin 仍走 ADMIN_FEISHU_OPENIDS env
          };
          setUser(ba);
          setToken('better-auth-session');
          // 同步写一份到 cookie 让现有 X-Feishu-User-Id 注入器能继续工作（PR-2 后会用 tenant_members 桥接）
          setCookie('user', JSON.stringify(ba));
          setCookie('token', 'better-auth-session');
          console.log('✅ 已通过 better-auth session 恢复用户');
          setAuthLoading(false);
          return;
        }
      } catch (err) {
        // session 解析失败不致命，继续 fallback
        console.warn('[auth] better-auth session 检查失败，回退到飞书 cookie：', err);
      }

      if (cancelled) return;

      // 步骤 2：飞书 cookie 兜底（保留现有内部主理人通道）
      console.log('🔍 AuthProvider init, checking cookies...');
      const savedUser = getCookie('user');
      const savedToken = getCookie('token');
      console.log('🔍 Found user cookie:', !!savedUser, 'token cookie:', !!savedToken);

      if (savedUser && savedToken) {
        try {
          setUser(JSON.parse(savedUser));
          setToken(savedToken);
          console.log('✅ Restored user from cookie');
        } catch (error) {
          console.error('Failed to parse user data:', error);
          deleteCookie('user');
          deleteCookie('token');
        }
      }

      // 步骤 3：localStorage 迁移（迁移期）
      if (!savedUser && !savedToken) {
        const lsUser = localStorage.getItem('user');
        const lsToken = localStorage.getItem('token');
        if (lsUser && lsToken) {
          try {
            setUser(JSON.parse(lsUser));
            setToken(lsToken);
            setCookie('user', lsUser);
            setCookie('token', lsToken);
            localStorage.removeItem('user');
            localStorage.removeItem('token');
          } catch (error) {
            console.error('Failed to migrate auth data:', error);
          }
        }
      }
      setAuthLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = (newUser: User, newToken: string) => {
    console.log('🔐 Login called, setting cookies with domain:', COOKIE_DOMAIN);
    setUser(newUser);
    setToken(newToken);
    setCookie('user', JSON.stringify(newUser));
    setCookie('token', newToken);
    console.log('🍪 Cookies after login:', document.cookie);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    deleteCookie('user');
    deleteCookie('token');
    // 清理可能残留的 localStorage
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    // 通知 better-auth 销毁 server session（fire-and-forget）
    void betterAuthSignOut();
  };

  const superAdminEmails = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '').split(',').filter(Boolean);
  const isSuperAdmin = !!user?.email && superAdminEmails.includes(user.email);

  const staffEmails = (import.meta.env.VITE_STAFF_EMAILS || '').split(',').filter(Boolean);
  const isStaff = !!user?.email && staffEmails.includes(user.email);

  const value = {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!user && !!token,
    isSuperAdmin,
    isStaff,
    authLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
