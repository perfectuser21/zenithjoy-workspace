/**
 * CustomerProfilePage — Line04 AI 客户运营台 · 客户人物肖像页（暗色重做）
 *
 * 路由：/wechat/crm/:contact?cs=<wechat_id>
 *
 * 暗色人物肖像：字母头像 + 状态徽章 + AI 三段论画像 + 时间轴 + 日报 + 聊天记录。
 * 全部 data-testid 保持与旧版一致（per 2026-06-25 Playwright 合同）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

// ──────────────────────────────────────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────────────────────────────────────

function sessionFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'include' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// ──────────────────────────────────────────────────────────────────────────────
// 类型
// ──────────────────────────────────────────────────────────────────────────────

type CrmStatus = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

const STATUS_LABELS: Record<CrmStatus, string> = {
  A1: 'A1 新客',
  A2: 'A2 沟通中',
  A3: 'A3 意向',
  A4: 'A4 成交',
  A5: 'A5 流失',
};

const STATUS_COLORS: Record<CrmStatus, string> = {
  A1: '#7a8092',
  A2: '#5b8cc4',
  A3: '#8f7bd6',
  A4: '#e3b169',
  A5: '#c0594d',
};

interface Portrait {
  need?: string | null;
  budget?: string | null;
  concern?: string | null;
  summary?: string | null;
  style?: string | null;
}

interface TimelineEvent {
  status: CrmStatus;
  at: string;
  note?: string | null;
}

interface DailyItem {
  day: string;
  summary: string;
}

interface ChatMessage {
  role: 'in' | 'out';
  text: string;
  created_at?: string;
}

interface CustomerProfile {
  name: string;
  contact: string;
  wechat_id?: string | null;
  status: CrmStatus;
  managed?: boolean;
  last_contact_at?: string | null;
  add_friend_time?: string | null;
  portrait?: Portrait | null;
  timeline?: TimelineEvent[] | null;
  dailies?: DailyItem[] | null;
  messages?: ChatMessage[] | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// 公共原子组件
// ──────────────────────────────────────────────────────────────────────────────

function Card({ testId, children, style }: {
  testId?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        background: '#191c27',
        border: '1px solid rgba(35,39,52,.55)',
        borderRadius: 12,
        padding: '18px 20px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: '0 0 12px',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '.15em',
      textTransform: 'uppercase' as const,
      color: '#6f7588',
    }}>{children}</h3>
  );
}

function EmptyHint({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <p data-testid={testId} style={{ color: '#6f7588', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
      {children}
    </p>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 主组件
// ──────────────────────────────────────────────────────────────────────────────

export default function CustomerProfilePage() {
  // 路由定义参数名是 :contactKey（navigation.config.ts），别名为 contact 供下方逻辑使用。
  // 历史 bug：曾读 useParams().contact → 永远 undefined → loadProfile 提前 return 卡「加载中」。
  const { contactKey: contact } = useParams<{ contactKey: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const csWechatId = searchParams.get('cs') ?? '';
  const nameHint = searchParams.get('name') ?? '';

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authExpired, setAuthExpired] = useState(false);
  const [error, setError] = useState<string>('');
  const [showChat, setShowChat] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!contact) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (csWechatId) params.set('cs_wechat_id', csWechatId);
      const qs = params.toString();
      const res = await sessionFetch(
        `/api/crm/customers/${encodeURIComponent(contact)}/profile${qs ? `?${qs}` : ''}`,
      );
      if (res.status === 401) {
        setAuthExpired(true);
        setError('登录已失效，请重新登录');
        return;
      }
      if (!res.ok) throw new Error(`加载失败（${res.status}）`);
      const data = (await res.json()) as { profile?: CustomerProfile } | CustomerProfile;
      const p = (data as { profile?: CustomerProfile }).profile ?? (data as CustomerProfile);
      setAuthExpired(false);
      setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [contact, csWechatId]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  // 全局暗色字体注入（Fraunces + Hanken Grotesk）
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,500&family=Hanken+Grotesk:wght@400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  const displayName = profile?.name || profile?.contact || nameHint || contact || '—';
  const status = (profile?.status as CrmStatus) ?? 'A1';
  const statusColor = STATUS_COLORS[status] ?? '#7a8092';
  const statusLabel = STATUS_LABELS[status] ?? status;

  // ── 样式对象 ──────────────────────────────────────────────────────────────

  const S = {
    page: {
      minHeight: '100vh',
      background: `
        radial-gradient(1000px 500px at 90% 0%, rgba(227,177,105,.08), transparent 55%),
        radial-gradient(800px 400px at 0% 100%, rgba(143,123,214,.07), transparent 50%),
        #0c0d11
      `,
      color: '#eef0f6',
      fontFamily: '"Hanken Grotesk","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
      WebkitFontSmoothing: 'antialiased' as const,
    },
    wrap: { maxWidth: 900, margin: '0 auto', padding: '24px 28px 60px' },
    backBtn: {
      background: 'none', border: '1px solid rgba(35,39,52,.8)', padding: '5px 12px',
      borderRadius: 8, color: '#aeb4c6', cursor: 'pointer', fontSize: 13,
      fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
      marginBottom: 20,
    },
    heroRow: { display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 24 },
    avatar: {
      width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
      background: statusColor, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#0c0d11',
    },
    heroRight: { flex: 1 },
    heroName: {
      fontFamily: '"Fraunces",serif', fontWeight: 600, fontSize: 32,
      margin: '0 0 6px', lineHeight: 1.1, letterSpacing: '-.01em',
    },
    badgeRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 8 },
    badge: (color: string): React.CSSProperties => ({
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 999,
      border: `1px solid ${color}33`,
      background: `${color}18`, color, fontSize: 12, fontWeight: 600,
    }),
    metaRow: { color: '#6f7588', fontSize: 12, display: 'flex', gap: 16, flexWrap: 'wrap' as const },
    grid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' },
    fieldRow: { display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
    fieldLabel: {
      minWidth: 64, fontSize: 11, color: '#6f7588', letterSpacing: '.04em',
      paddingTop: 2, flexShrink: 0,
    },
    fieldVal: { color: '#eef0f6', fontSize: 13, lineHeight: 1.55, flex: 1 },
    tlItem: {
      borderLeft: `2px solid rgba(35,39,52,.8)`, paddingLeft: 14, paddingBottom: 14,
      position: 'relative' as const,
    },
    tlDot: (color: string): React.CSSProperties => ({
      width: 9, height: 9, borderRadius: '50%', background: color,
      position: 'absolute', left: -5.5, top: 2, border: '1.5px solid #0c0d11',
    }),
    tlTime: { fontSize: 11, color: '#6f7588' },
    tlText: { fontSize: 13, color: '#eef0f6', marginTop: 3 },
    dailyItem: { padding: '10px 0', borderBottom: '1px solid rgba(35,39,52,.5)' },
    dailyDay: { fontSize: 11, color: '#6f7588', marginBottom: 4 },
    dailySummary: { fontSize: 13, color: '#aeb4c6', lineHeight: 1.55 },
    chatToggle: {
      background: 'none', border: '1px solid rgba(35,39,52,.8)',
      padding: '6px 14px', borderRadius: 8, color: '#aeb4c6',
      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
    },
    chatBubble: (role: string): React.CSSProperties => ({
      display: 'flex',
      justifyContent: role === 'out' ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }),
    bubblePill: (role: string): React.CSSProperties => ({
      maxWidth: '75%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
      background: role === 'out' ? '#2563eb' : '#232734',
      color: role === 'out' ? '#fff' : '#eef0f6',
    }),
  };

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        {/* 返回按钮 */}
        <button
          data-testid="crm-profile-back"
          style={S.backBtn}
          onClick={() => navigate(-1)}
        >
          ← 返回列表
        </button>

        {authExpired && (
          <div role="alert" data-testid="crm-profile-auth-expired"
            style={{ color: '#f87171', marginBottom: 16, fontSize: 13 }}>
            登录已失效，请重新登录
          </div>
        )}

        {loading && (
          <p style={{ color: '#6f7588', textAlign: 'center', padding: '32px 0' }}>加载中…</p>
        )}

        {!loading && error && !authExpired && (
          <p role="alert" style={{ color: '#f87171' }}>错误：{error}</p>
        )}

        {!loading && profile && (
          <>
            {/* ── 人物肖像头部 ── */}
            <div style={S.heroRow}>
              <div style={S.avatar}>{displayName.charAt(0)}</div>
              <div style={S.heroRight}>
                <h1 data-testid="crm-profile-name" style={S.heroName}>{displayName}</h1>
                <div style={S.badgeRow}>
                  <span style={S.badge(statusColor)}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: statusColor, display: 'inline-block',
                    }} />
                    {statusLabel}
                  </span>
                  {profile.managed !== false && (
                    <span style={S.badge('#5b8cc4')}>AI 接管中</span>
                  )}
                </div>
                <div style={S.metaRow}>
                  {profile.wechat_id && <span>微信号：{profile.wechat_id}</span>}
                  {profile.add_friend_time && <span>加好友：{fmtDate(profile.add_friend_time)}</span>}
                  {profile.last_contact_at && <span>最近联系：{fmtDate(profile.last_contact_at)}</span>}
                </div>
              </div>
            </div>

            {/* ── 卡片网格 ── */}
            <div style={S.grid}>
              {/* 基本信息 */}
              <Card testId="crm-profile-basic">
                <CardTitle>基本信息</CardTitle>
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>姓名</span>
                  <span style={S.fieldVal}>{profile.name || '—'}</span>
                </div>
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>联系人</span>
                  <span style={S.fieldVal}>{profile.contact || '—'}</span>
                </div>
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>意向</span>
                  <span style={{ ...S.fieldVal, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                </div>
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>加微信</span>
                  <span style={S.fieldVal}>{fmtDateTime(profile.add_friend_time ?? null)}</span>
                </div>
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>最近联系</span>
                  <span style={S.fieldVal}>{fmtDateTime(profile.last_contact_at ?? null)}</span>
                </div>
              </Card>

              {/* AI 客户画像 */}
              <Card testId="crm-profile-portrait">
                <CardTitle>AI 客户画像</CardTitle>
                {!profile.portrait ||
                  (!profile.portrait.need && !profile.portrait.budget && !profile.portrait.concern) ? (
                  <EmptyHint testId="crm-portrait-empty">
                    AI 还没生成画像。等客户多发几条消息，AI 会自动分析需求/预算/顾虑。
                  </EmptyHint>
                ) : (
                  <>
                    {profile.portrait.need && (
                      <div style={S.fieldRow}>
                        <span style={S.fieldLabel}>核心需求</span>
                        <span data-testid="crm-portrait-need" style={S.fieldVal}>
                          {profile.portrait.need}
                        </span>
                      </div>
                    )}
                    {profile.portrait.budget && (
                      <div style={S.fieldRow}>
                        <span style={S.fieldLabel}>预算</span>
                        <span data-testid="crm-portrait-budget" style={S.fieldVal}>
                          {profile.portrait.budget}
                        </span>
                      </div>
                    )}
                    {profile.portrait.concern && (
                      <div style={S.fieldRow}>
                        <span style={S.fieldLabel}>顾虑</span>
                        <span data-testid="crm-portrait-concern" style={S.fieldVal}>
                          {profile.portrait.concern}
                        </span>
                      </div>
                    )}
                    {profile.portrait.style && (
                      <div style={S.fieldRow}>
                        <span style={S.fieldLabel}>风格</span>
                        <span style={S.fieldVal}>{profile.portrait.style}</span>
                      </div>
                    )}
                    {profile.portrait.summary && (
                      <div style={{
                        marginTop: 8, padding: '8px 10px',
                        background: 'rgba(35,39,52,.5)',
                        borderRadius: 8, fontSize: 12.5, color: '#aeb4c6', lineHeight: 1.6,
                      }}>
                        {profile.portrait.summary}
                      </div>
                    )}
                  </>
                )}
              </Card>

              {/* 状态时间轴 */}
              <Card testId="crm-profile-timeline">
                <CardTitle>状态时间轴</CardTitle>
                {!profile.timeline?.length ? (
                  <EmptyHint testId="crm-timeline-empty">还没有状态变化记录。</EmptyHint>
                ) : (
                  <div>
                    {profile.timeline.map((ev, i) => {
                      const evStatus = ev.status as CrmStatus;
                      const color = STATUS_COLORS[evStatus] ?? '#7a8092';
                      return (
                        <div key={i} data-testid="crm-timeline-event" style={S.tlItem}>
                          <span style={S.tlDot(color)} />
                          <div style={S.tlTime}>
                            {fmtDate(ev.at)} ·{' '}
                            <span style={{ color }}>
                              {STATUS_LABELS[evStatus] ?? ev.status}
                            </span>
                          </div>
                          {ev.note && <div style={S.tlText}>{ev.note}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* 每日日报 */}
              <Card testId="crm-profile-dailies">
                <CardTitle>每日 AI 日报</CardTitle>
                {!profile.dailies?.length ? (
                  <EmptyHint testId="crm-dailies-empty">
                    还没有日报。等 AI 每天凌晨汇总后自动出现。
                  </EmptyHint>
                ) : (
                  <div>
                    {profile.dailies.map((d, i) => (
                      <div key={i} data-testid="crm-daily-item" style={S.dailyItem}>
                        <div style={S.dailyDay}>{fmtDate(d.day)}</div>
                        <div style={S.dailySummary}>{d.summary}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* 聊天记录（可展开/折叠）*/}
            <Card testId="crm-profile-chat" style={{ marginTop: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 12,
              }}>
                <CardTitle>聊天记录</CardTitle>
                <button
                  data-testid="crm-chat-toggle"
                  style={S.chatToggle}
                  onClick={() => setShowChat(v => !v)}
                >
                  {showChat ? '收起' : '展开聊天记录'}
                </button>
              </div>
              {showChat && (
                <div data-testid="crm-chat-panel">
                  {!profile.messages?.length ? (
                    <EmptyHint testId="crm-chat-empty">还没有聊天记录。</EmptyHint>
                  ) : (
                    <div>
                      {profile.messages.map((msg, i) => (
                        <div key={i} data-testid="crm-chat-bubble" style={S.chatBubble(msg.role)}>
                          <div style={S.bubblePill(msg.role)}>{msg.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
