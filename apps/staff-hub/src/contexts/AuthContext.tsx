import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSession, signOut } from '../api/betterAuth';
import { fetchOrgs, switchOrg as switchOrgApi, type Org } from '../api/orgContext';
import { setOrgErrorListener } from '../lib/knowledgeFetch';
import { clearAllDrafts, hasUnsavedDraft } from '../lib/draftGuard';

const COOKIE_DOMAIN = '.zenjoymedia.media';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** 跨标签页广播频道名：一处切企业，其它标签页据此同步（真隔离仍在服务端，这里只是提示重拉）。 */
const ORG_CHANNEL = 'org-context';

interface OrgSwitchMessage {
  type: 'switch';
  orgId: string;
}

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

/** 登录返回体里带的组织上下文，用于登录成功后一次性填充（省一次 /org 往返）。 */
export interface OrgBootstrap {
  orgs?: Org[];
  active_org_id?: string | null;
  needs_selection?: boolean;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  login: (user: User, token?: string, orgBootstrap?: OrgBootstrap) => void;
  logout: () => void;
  // ── 多组织维度 ──────────────────────────────────────────────────────────────
  orgs: Org[];
  currentOrgId: string | null;
  needsOrgSelection: boolean;
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
  /** 别的标签页切了企业、但本页有未提交草稿时的待决目标 org（非空 = 需先弹拦截提示） */
  pendingRemoteSwitch: string | null;
  /** 放弃草稿并接受别的标签页的切换 */
  confirmRemoteSwitch: () => void;
  /** 留在当前、先去保存草稿（暂不切换） */
  dismissRemoteSwitch: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true';
const MOCK_EMAIL = import.meta.env.VITE_MOCK_USER_EMAIL || 'staff@test.com';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [needsOrgSelection, setNeedsOrgSelection] = useState(false);
  const [pendingRemoteSwitch, setPendingRemoteSwitch] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const applyOrgState = useCallback((next: {
    orgs: Org[];
    active_org_id: string | null;
    needs_selection: boolean;
  }) => {
    setOrgs(next.orgs);
    setCurrentOrgId(next.active_org_id);
    setNeedsOrgSelection(next.needs_selection);
  }, []);

  const refreshOrgs = useCallback(async () => {
    try {
      const ctx = await fetchOrgs();
      applyOrgState(ctx);
    } catch {
      // 拉取失败best-effort：保持现有 org 状态，别把整个前台拖白屏
    }
  }, [applyOrgState]);

  // 会话恢复 / 首次进入：拉一次会话，authenticated 就填充组织上下文
  useEffect(() => {
    if (SKIP_AUTH) {
      setUser({ id: 'mock-staff-user', name: 'Staff Mock User', email: MOCK_EMAIL });
      // mock 给单企业默认，保证本地开发不被逼选、切换器只显示当前企业名
      applyOrgState({
        orgs: [{ org_id: 'mock-org', name: 'Mock 组织', role: 'owner' }],
        active_org_id: 'mock-org',
        needs_selection: false,
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
        try {
          const ctx = await fetchOrgs();
          if (!cancelled) applyOrgState(ctx);
        } catch {
          // best-effort
        }
        if (!cancelled) setAuthLoading(false);
        return;
      }

      const savedUser = getCookie('user');
      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser) as User);
          try {
            const ctx = await fetchOrgs();
            if (!cancelled) applyOrgState(ctx);
          } catch {
            // best-effort
          }
        } catch {
          deleteCookie('user');
          deleteCookie('token');
        }
      }
      if (!cancelled) setAuthLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyOrgState]);

  // 数据端点撞上 409/403 组织态错误时的集中处理：逼选 / 刷新归属重选
  useEffect(() => {
    setOrgErrorListener((code) => {
      if (code === 'ORG_SELECTION_REQUIRED') {
        setNeedsOrgSelection(true);
      } else if (code === 'ORG_FORBIDDEN') {
        // active_org 失效/被伪造 → 拉服务端真相（needs_selection 以服务端为准）
        void refreshOrgs();
      }
    });
    return () => setOrgErrorListener(null);
  }, [refreshOrgs]);

  // 跨标签页广播：收到别的标签页的切换 → 有草稿先拦截，无草稿直接换当前 org（触发数据重拉）
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(ORG_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as OrgSwitchMessage | null;
      if (!msg || msg.type !== 'switch' || typeof msg.orgId !== 'string') return;
      if (hasUnsavedDraft()) {
        setPendingRemoteSwitch(msg.orgId);
      } else {
        setCurrentOrgId(msg.orgId);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const login = useCallback(
    (nextUser: User, token = 'better-auth-session', orgBootstrap?: OrgBootstrap) => {
      setUser(nextUser);
      setCookie('user', JSON.stringify(nextUser));
      setCookie('token', token);
      if (orgBootstrap?.orgs) {
        applyOrgState({
          orgs: orgBootstrap.orgs,
          active_org_id: orgBootstrap.active_org_id ?? null,
          needs_selection: !!orgBootstrap.needs_selection,
        });
      } else {
        void refreshOrgs();
      }
    },
    [applyOrgState, refreshOrgs]
  );

  const logout = useCallback(() => {
    setUser(null);
    setOrgs([]);
    setCurrentOrgId(null);
    setNeedsOrgSelection(false);
    deleteCookie('user');
    deleteCookie('token');
    void signOut();
  }, []);

  const switchOrg = useCallback(async (orgId: string) => {
    // org 只经服务端受校验地切换：这里拿服务端最终落定的 active_org_id 为准
    const res = await switchOrgApi(orgId);
    setCurrentOrgId(res.active_org_id);
    setNeedsOrgSelection(false);
    clearAllDrafts();
    channelRef.current?.postMessage({ type: 'switch', orgId: res.active_org_id } as OrgSwitchMessage);
  }, []);

  const confirmRemoteSwitch = useCallback(() => {
    setPendingRemoteSwitch((pending) => {
      if (pending) {
        clearAllDrafts();
        setCurrentOrgId(pending);
      }
      return null;
    });
  }, []);

  const dismissRemoteSwitch = useCallback(() => setPendingRemoteSwitch(null), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        authLoading,
        login,
        logout,
        orgs,
        currentOrgId,
        needsOrgSelection,
        switchOrg,
        refreshOrgs,
        pendingRemoteSwitch,
        confirmRemoteSwitch,
        dismissRemoteSwitch,
      }}
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
