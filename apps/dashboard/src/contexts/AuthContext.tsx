import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';

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

  // 初始化时从 cookie 读取用户信息（跨子域名共享）
  useEffect(() => {
    // 开发模式：跳过登录，直接使用 mock 用户
    if (SKIP_AUTH && MOCK_USER) {
      console.log('🔧 开发模式：跳过登录，使用 mock 用户');
      setUser(MOCK_USER);
      setToken('dev-token-mock');
      setAuthLoading(false);
      return;
    }

    console.log('🔍 AuthProvider init, checking cookies...');
    console.log('🍪 All cookies:', document.cookie);
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

    // 迁移：如果 localStorage 有数据但 cookie 没有，迁移到 cookie
    if (!savedUser && !savedToken) {
      const lsUser = localStorage.getItem('user');
      const lsToken = localStorage.getItem('token');
      if (lsUser && lsToken) {
        try {
          setUser(JSON.parse(lsUser));
          setToken(lsToken);
          setCookie('user', lsUser);
          setCookie('token', lsToken);
          // 清理 localStorage
          localStorage.removeItem('user');
          localStorage.removeItem('token');
        } catch (error) {
          console.error('Failed to migrate auth data:', error);
        }
      }
    }
    setAuthLoading(false);
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
  };

  // 超级管理员飞书 ID 列表（环境变量配置）
  // 注意：user.id 就是飞书的 open_id，user.feishu_user_id 是可选的兼容字段
  const superAdminIds = (import.meta.env.VITE_SUPER_ADMIN_FEISHU_IDS || '').split(',').filter(Boolean);
  const userFeishuId = user?.feishu_user_id || user?.id;
  const isSuperAdmin = !!userFeishuId && superAdminIds.includes(userFeishuId);

  // 调试日志
  console.log('🔑 权限检查:', { userFeishuId, superAdminIds, isSuperAdmin });

  const value = {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!user && !!token,
    isSuperAdmin,
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
