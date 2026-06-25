/**
 * CustomerProfilePage — Line04 CRM 客户状态/画像页（层2）+ 真实聊天记录（层3）
 *
 * 路由：/wechat/crm/:contactKey（?cs=<cs_wechat_id>&name=<显示名>）
 *
 * 层2（整页详情，参考 PipelineOutputPage）：
 *   - Profile 基础信息（姓名 / 微信号 / 状态 A1-A5 / 最后联系）
 *   - AI 画像（需求 / 预算 / 顾虑，源自 cs_memory_longterm 融合 summary）
 *   - 状态时间线（A1→A5 流转）
 *   - 每日小结流（cs_memory_daily 按天 summary）
 * 层3（层2 内按需下钻，参考 ContentFactoryPage handleToggleExpand）：
 *   - 真实聊天记录逐句气泡流（cs_memory_messages：客户 in / 客服 out）
 *
 * 数据源：GET /api/crm/customers/:contactKey/profile（session 多通道，credentials:'include'）。
 *   依赖 backend PR 提供该端点；端点未落地时整页安全降级（显示空态，不报错）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

type CrmStatus = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

const STATUS_LABELS: Record<CrmStatus, string> = {
  A1: 'A1 新客',
  A2: 'A2 沟通中',
  A3: 'A3 意向',
  A4: 'A4 成交',
  A5: 'A5 流失',
};

// 层3 一句聊天：role in=客户 / out=客服
interface ChatMessage {
  role: 'in' | 'out';
  text: string;
  created_at?: string | null;
}

// 状态时间线一条流转
interface StatusEvent {
  status: CrmStatus;
  at: string | null;
  note?: string | null;
}

// 每日小结一条
interface DailySummary {
  day: string;
  summary: string;
}

// AI 画像（从长期记忆抽取）
interface AiPortrait {
  need?: string | null; // 需求
  budget?: string | null; // 预算
  concern?: string | null; // 顾虑
  summary?: string | null; // 长期记忆融合原文（兜底全展示）
}

interface CustomerProfile {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: CrmStatus;
  managed: boolean;
  last_contact_at: string | null;
  portrait: AiPortrait | null;
  timeline: StatusEvent[];
  dailies: DailySummary[];
  messages: ChatMessage[];
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 10, color: '#111827' };

export default function CustomerProfilePage() {
  const navigate = useNavigate();
  const { contactKey = '' } = useParams();
  const [search] = useSearchParams();
  const contact = useMemo(() => decodeURIComponent(contactKey), [contactKey]);
  const csWechatId = search.get('cs') ?? '';
  const fallbackName = search.get('name') ?? contact;

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [authExpired, setAuthExpired] = useState(false);

  // 层3 聊天记录按需展开（参考 ContentFactoryPage.handleToggleExpand）
  const [chatExpanded, setChatExpanded] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (csWechatId) params.set('cs', csWechatId);
      const qs = params.toString();
      const url = `/api/crm/customers/${encodeURIComponent(contact)}/profile${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) {
        setAuthExpired(true);
        setError('登录已失效，请重新登录');
        return;
      }
      if (res.status === 404) {
        // 端点未落地 / 客户无记录 → 空态降级（仍渲染骨架，不报错）
        setProfile(null);
        return;
      }
      if (!res.ok) throw new Error(`加载失败（${res.status}）`);
      const data = (await res.json()) as { profile?: CustomerProfile } | CustomerProfile;
      const p = (data as { profile?: CustomerProfile }).profile ?? (data as CustomerProfile);
      setProfile(p && typeof p === 'object' && 'contact' in p ? p : null);
      setAuthExpired(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [contact, csWechatId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const displayName = profile?.name || fallbackName;
  const portrait = profile?.portrait ?? null;
  const timeline = profile?.timeline ?? [];
  const dailies = profile?.dailies ?? [];
  const messages = profile?.messages ?? [];

  return (
    <div className="customer-profile-page" style={{ padding: 24, maxWidth: 880, margin: '0 auto' }}>
      <button
        type="button"
        data-testid="crm-profile-back"
        onClick={() => navigate('/wechat/crm')}
        style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, marginBottom: 12 }}
      >
        ← 返回客户好友表
      </button>

      <h1 data-testid="crm-profile-name" style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        {displayName}
      </h1>

      {authExpired && (
        <div role="alert" data-testid="crm-profile-auth-expired" style={{ color: '#b91c1c', margin: '8px 0' }}>
          登录已失效，请重新登录
        </div>
      )}
      {error && !authExpired && (
        <div role="alert" style={{ color: '#b91c1c', margin: '8px 0' }}>
          错误：{error}
        </div>
      )}

      {loading ? (
        <div>加载中...</div>
      ) : (
        <>
          {/* ── Profile 基础信息 ── */}
          <div style={card} data-testid="crm-profile-basic">
            <div style={sectionTitle}>基础信息</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14, color: '#374151' }}>
              <div>微信号：{profile?.wechat_id ?? '—'}</div>
              <div>
                状态：{profile?.status ? STATUS_LABELS[profile.status] : '—'}
              </div>
              <div>
                接管：
                <span style={{ color: profile?.managed === false ? '#dc2626' : '#15803d' }}>
                  {profile?.managed === false ? '已排除（黑名单）' : '接管中'}
                </span>
              </div>
              <div>最后联系：{fmtTime(profile?.last_contact_at)}</div>
            </div>
          </div>

          {/* ── AI 画像（需求 / 预算 / 顾虑，源自长期记忆） ── */}
          <div style={card} data-testid="crm-profile-portrait">
            <div style={sectionTitle}>AI 画像</div>
            {portrait ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 14 }}>
                <div data-testid="crm-portrait-need">
                  <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>需求</div>
                  <div>{portrait.need || '—'}</div>
                </div>
                <div data-testid="crm-portrait-budget">
                  <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>预算</div>
                  <div>{portrait.budget || '—'}</div>
                </div>
                <div data-testid="crm-portrait-concern">
                  <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>顾虑</div>
                  <div>{portrait.concern || '—'}</div>
                </div>
                {portrait.summary && (
                  <div style={{ gridColumn: '1 / -1', marginTop: 8, color: '#6b7280', whiteSpace: 'pre-wrap' }}>
                    {portrait.summary}
                  </div>
                )}
              </div>
            ) : (
              <div data-testid="crm-portrait-empty" style={{ color: '#9ca3af', fontSize: 14 }}>
                暂无 AI 画像（聊得多了 AI 会自动总结需求/预算/顾虑）
              </div>
            )}
          </div>

          {/* ── 状态时间线 ── */}
          <div style={card} data-testid="crm-profile-timeline">
            <div style={sectionTitle}>状态时间线</div>
            {timeline.length === 0 ? (
              <div data-testid="crm-timeline-empty" style={{ color: '#9ca3af', fontSize: 14 }}>
                暂无状态流转记录
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {timeline.map((ev, i) => (
                  <div key={i} data-testid="crm-timeline-event" style={{ display: 'flex', gap: 10, fontSize: 14 }}>
                    <span style={{ color: '#9ca3af', minWidth: 150 }}>{fmtTime(ev.at)}</span>
                    <span style={{ fontWeight: 600 }}>{STATUS_LABELS[ev.status] ?? ev.status}</span>
                    {ev.note && <span style={{ color: '#6b7280' }}>{ev.note}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 每日小结流（cs_memory_daily） ── */}
          <div style={card} data-testid="crm-profile-dailies">
            <div style={sectionTitle}>每日小结</div>
            {dailies.length === 0 ? (
              <div data-testid="crm-dailies-empty" style={{ color: '#9ca3af', fontSize: 14 }}>
                暂无每日小结
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {dailies.map((d, i) => (
                  <div key={i} data-testid="crm-daily-item">
                    <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 2 }}>{d.day}</div>
                    <div style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap' }}>{d.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 层3：真实聊天记录（按需展开下钻） ── */}
          <div style={card} data-testid="crm-profile-chat">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={sectionTitle}>聊天记录</div>
              <button
                type="button"
                data-testid="crm-chat-toggle"
                onClick={() => setChatExpanded((v) => !v)}
                style={{
                  padding: '4px 10px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #ddd',
                  background: '#f9fafb',
                  cursor: 'pointer',
                }}
              >
                {chatExpanded ? '收起聊天记录' : '查看聊天记录'}
              </button>
            </div>
            {chatExpanded && (
              <div data-testid="crm-chat-panel" style={{ marginTop: 12 }}>
                {messages.length === 0 ? (
                  <div data-testid="crm-chat-empty" style={{ color: '#9ca3af', fontSize: 14 }}>
                    暂无聊天记录
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {messages.map((m, i) => {
                      const isCustomer = m.role === 'in';
                      return (
                        <div
                          key={i}
                          data-testid="crm-chat-bubble"
                          data-role={m.role}
                          style={{ display: 'flex', justifyContent: isCustomer ? 'flex-start' : 'flex-end' }}
                        >
                          <div
                            style={{
                              maxWidth: '70%',
                              padding: '8px 12px',
                              borderRadius: 12,
                              fontSize: 14,
                              background: isCustomer ? '#f3f4f6' : '#dbeafe',
                              color: '#111827',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 2 }}>
                              {isCustomer ? '客户' : '客服'} · {fmtTime(m.created_at)}
                            </div>
                            {m.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
