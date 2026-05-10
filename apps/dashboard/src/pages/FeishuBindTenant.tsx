/**
 * Path 2 Sprint A WS4: 客户自助绑飞书页
 *
 * 路由：/dashboard/feishu-bind
 *
 * 5 状态：
 *   1. 未绑定 → 渲染 app_id/app_secret 表单 + "开始绑定" 按钮
 *   2. 已绑定 → "飞书已绑定 ✓" + Bitable 链接 + "刷新状态" 按钮
 *   3. R1 ?error=<code> → 渲染错码 + 中文文案
 *   4. R3 BITABLE_NOT_FOUND（lead-config 调用返） → 重建按钮
 *   5. R4 ?error=ALREADY_BOUND → 禁用提交 + 换绑提示
 *   6. R5 TOKEN_REFRESH_FAILED → 重新授权按钮
 */
import { useEffect, useState } from 'react';

interface BindStatus {
  bound: boolean;
  app_token?: string;
  // bitable_url 形如 https://example.feishu.cn/base/<app_token>
  bitable_url?: string;
}

// 后端可能返 app_token 但缺 bitable_url；前端兜底拼一个 https://*.feishu.cn/base/<app_token>
function fallbackBitableUrl(appToken?: string): string | undefined {
  if (!appToken) return undefined;
  return `https://feishu.cn/base/${appToken}`;
}

interface LeadConfigData {
  profile: { industry: string; keyword: string; hook: string };
  target_videos: Array<{ url: string; note?: string }>;
}

const ERROR_CN: Record<string, string> = {
  ALREADY_BOUND: '该 tenant 已绑定飞书，请先解绑后再换绑。',
  PROVISION_FAILED: '飞书 Bitable 建表失败，请检查 app 权限（bitable:app + drive:drive）后重试。',
  BITABLE_NOT_FOUND: '飞书文档已不存在，请点"一键重建"。',
  TOKEN_REFRESH_FAILED: '飞书授权已失效，请重新绑定。',
  INVALID_STATE: '回调验签失败，请重新发起绑定。',
  TENANT_NOT_FOUND: '当前租户不存在。',
  START_FAILED: '飞书绑定启动失败，请刷新重试。',
  BIND_FAILED: '飞书绑定失败，请检查 App ID/Secret 是否正确。',
  REBUILD_FAILED: '重建 Bitable 失败，请稍后重试或联系支持。',
  TENANT_ID_REQUIRED: '当前用户未关联租户，请重新登录或联系管理员。',
  MISSING_FIELDS: '请填写完整的 App ID 和 App Secret。',
  NO_TENANT_CONTEXT: '当前用户未关联租户，请重新登录或联系管理员。',
};

function getQueryError(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const href = window.location?.href;
    if (!href) return null;
    const u = new URL(href, 'http://localhost');
    return u.searchParams.get('error');
  } catch {
    return null;
  }
}

export default function FeishuBindTenant() {
  const [status, setStatus] = useState<BindStatus | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leadConfig, setLeadConfig] = useState<LeadConfigData | null>(null);
  const [leadConfigError, setLeadConfigError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const urlError = getQueryError();
  const isAlreadyBound = urlError === 'ALREADY_BOUND';

  // 初次加载状态
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/feishu/oauth/status')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success && j.data) setStatus(j.data as BindStatus);
        else setStatus({ bound: false });
      })
      .catch(() => {
        if (!cancelled) setStatus({ bound: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isAlreadyBound) return;
    if (!appId || !appSecret) return;
    setSubmitting(true);
    setLeadConfigError(null);
    try {
      // [ARCH] 0-touch app credentials provision — 同步建 Bitable + 3 表
      // 不再走 OAuth 跳转（旧: /start + window.location.href = authorize_url）
      // 后端可能耗时 5-15s（实际调飞书建文档/表）— UI 显示「建表中...」
      const res = await fetch('/api/feishu/oauth/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const j = await res.json();
      if (j?.success && j.data?.app_token) {
        // 直接渲染绑定状态 — 不依赖 callback 跳回
        setStatus({
          bound: true,
          app_token: j.data.app_token,
          bitable_url: j.data.bitable_doc_url,
        });
        // 清表单避免回看时残留 secret
        setAppSecret('');
      } else {
        setLeadConfigError(j?.error?.code || 'BIND_FAILED');
      }
    } catch (err) {
      setLeadConfigError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshLeadConfig() {
    if (!status?.bound) return;
    setRefreshing(true);
    setLeadConfigError(null);
    try {
      // tenantId 实际从 session 取，这里走 self
      const res = await fetch('/api/lead-config/self');
      const j = await res.json();
      if (j?.success) {
        setLeadConfig(j.data as LeadConfigData);
      } else {
        setLeadConfigError(j?.error?.code || 'FETCH_FAILED');
      }
    } catch (err) {
      setLeadConfigError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function rebuildBitable() {
    setRefreshing(true);
    try {
      // [ARCH] /rebuild 同步重建 — 后端 DELETE binding + 重 provisionBitable
      const res = await fetch('/api/feishu/oauth/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (j?.success && j.data?.app_token) {
        setLeadConfigError(null);
        setStatus({
          bound: true,
          app_token: j.data.app_token,
          bitable_url: j.data.bitable_doc_url,
        });
        await refreshLeadConfig();
      } else {
        setLeadConfigError(j?.error?.code || 'REBUILD_FAILED');
      }
    } finally {
      setRefreshing(false);
    }
  }

  function reauthorize() {
    setAppId('');
    setAppSecret('');
    window.location.href = '/dashboard/feishu-bind';
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>绑定飞书 — 自动建获客 workspace</h1>

      {/* R1 / R4 / 其他 OAuth 错误展示 */}
      {urlError && (
        <div
          style={{
            background: '#fff3cd',
            border: '1px solid #ffc107',
            padding: 12,
            marginBottom: 16,
            borderRadius: 6,
          }}
          data-testid="oauth-error-banner"
        >
          <strong>飞书绑定失败：</strong> 错误码 <code>{urlError}</code> —{' '}
          {ERROR_CN[urlError] || '未知错误'}
        </div>
      )}

      {loading && <p>加载中...</p>}

      {/* Bug 2 fix: oauth/start / refreshLeadConfig 失败时显示错误（之前 setLeadConfigError 但没渲染 → 用户感觉无反应） */}
      {leadConfigError && (
        <div style={{
          padding: 12,
          background: '#fee',
          color: '#c00',
          borderRadius: 6,
          marginBottom: 12,
          border: '1px solid #fcc',
        }}>
          <strong>绑定失败：</strong> {ERROR_CN[leadConfigError as keyof typeof ERROR_CN] || leadConfigError}
        </div>
      )}

      {!loading && !status?.bound && (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label htmlFor="app_id">App ID（飞书应用的 app_id）</label>
          <input
            id="app_id"
            name="app_id"
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="cli_xxxxx"
            required
            style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
          />

          <label htmlFor="app_secret">App Secret</label>
          <input
            id="app_secret"
            name="app_secret"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="自建应用的 secret"
            required
            style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
          />

          <button
            type="submit"
            disabled={submitting || isAlreadyBound}
            style={{
              padding: '10px 20px',
              background: isAlreadyBound ? '#999' : '#0066ff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: isAlreadyBound ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? '建表中...（约 10 秒）' : '开始绑定'}
          </button>

          {isAlreadyBound && (
            <p style={{ color: '#dc3545' }}>
              已绑过飞书，换绑请先到「设置 → 飞书集成」解绑。
            </p>
          )}
        </form>
      )}

      {!loading && status?.bound && (
        <div>
          <p style={{ fontSize: 18, color: '#10b981' }}>飞书已绑定 ✓</p>
          {(status.bitable_url || fallbackBitableUrl(status.app_token)) && (
            <p>
              <a
                href={status.bitable_url || fallbackBitableUrl(status.app_token) || '#'}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#0066ff' }}
              >
                查看 Bitable 多维表格
              </a>
            </p>
          )}
          <button
            type="button"
            onClick={refreshLeadConfig}
            disabled={refreshing}
            style={{
              padding: '8px 16px',
              background: '#0066ff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              marginRight: 8,
            }}
          >
            {refreshing ? '加载中...' : '刷新状态'}
          </button>

          {leadConfigError === 'BITABLE_NOT_FOUND' && (
            <button
              type="button"
              onClick={rebuildBitable}
              style={{
                padding: '8px 16px',
                background: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
              }}
            >
              一键重建 Bitable
            </button>
          )}

          {leadConfigError === 'TOKEN_REFRESH_FAILED' && (
            <button
              type="button"
              onClick={reauthorize}
              style={{
                padding: '8px 16px',
                background: '#f59e0b',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
              }}
            >
              重新授权飞书
            </button>
          )}

          {leadConfig && (
            <div style={{ marginTop: 24, padding: 16, background: '#f8f9fa', borderRadius: 6 }}>
              <h3>获客画像</h3>
              <ul>
                <li>
                  行业：<span>{leadConfig.profile.industry}</span>
                </li>
                <li>
                  关键词：<span>{leadConfig.profile.keyword}</span>
                </li>
                <li>
                  钩子文案：<span>{leadConfig.profile.hook}</span>
                </li>
              </ul>

              <h3>对标视频（{leadConfig.target_videos.length} 个）</h3>
              <ul>
                {leadConfig.target_videos.map((v, i) => (
                  <li key={i}>
                    <a href={v.url} target="_blank" rel="noreferrer">
                      {v.url}
                    </a>
                    {v.note && <span> — {v.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {leadConfigError && leadConfigError !== 'BITABLE_NOT_FOUND' && leadConfigError !== 'TOKEN_REFRESH_FAILED' && (
            <p style={{ color: '#dc3545', marginTop: 12 }}>
              拉数据失败：{leadConfigError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
