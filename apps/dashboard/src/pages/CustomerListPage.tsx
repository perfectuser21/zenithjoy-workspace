/**
 * CustomerListPage — Line04 中台 AI-native CRM·客户好友表（层1）
 *
 * 路由：/wechat/crm（归进「私域客服」板块卡片下钻；旧 /customers 301 → 此处）
 *
 * 一屏好友表（agent 扫来的近期会话联系人）：姓名 | 状态(A1-A5 下拉) | 最后联系 | 接管开关。
 * **黑名单语义（修正3）**：开关默认「接管中」(managed=true)；勾掉 = 加黑名单
 * （PUT /customers/manage managed=false → 后端写 blacklist），agent 此后不回他，其余人照常 AI 回。
 * 顶部一条 onboarding 状态条（O1-O5 绿/灰/红，GET /onboarding/:csWechatId）。
 * 点某行 → 下钻层2 状态/画像页（/wechat/crm/:contactKey）。
 *
 * **per-operator 重做（2026-06-25 契约）**：
 *  - 一个 email 账号 → 绑一个微信(客服机)→ 那个微信下的联系人 = 她的客户。运营**登录即只看自己的客户**。
 *  - 全部 CRM 请求改普通 **session fetch**（credentials:'include'，让 better-auth session cookie 随行），
 *    **不再注入 X-User-Email 超管头**；GET /customers **不带 cs_wechat_id**，后端按 req.tenantId 自动 scope。
 *  - **去掉「选客服机」下拉**：单微信直接显示；写接口（manage/status/POST/trigger）用后端回的
 *    cs_wechat_id 作目标 key。超管那套（决策5 须显式 cs_wechat_id）只在后端 super-admin 旁路生效，不套到运营头上。
 *  - 「立即扫好友」做成顶部显眼主按钮（运营来这儿就是要「采集客户」）。
 *  - 客服机人设名 / 在线状态挪到「我的客服机」卡（CsOneClickSetupPage），列表只剩客户行。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 普通 session fetch：带 credentials:'include' 让 better-auth session cookie 随行，
// 后端 tenantContext 据此自动 scope 到当前运营的租户。绝不注入 X-User-Email 超管头。
function sessionFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'include' });
}

type CrmStatus = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

const STATUS_OPTIONS: CrmStatus[] = ['A1', 'A2', 'A3', 'A4', 'A5'];
const STATUS_LABELS: Record<CrmStatus, string> = {
  A1: 'A1 新客',
  A2: 'A2 沟通中',
  A3: 'A3 意向',
  A4: 'A4 成交',
  A5: 'A5 流失',
};

interface CustomerRow {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: CrmStatus;
  last_contact_at: string | null;
  managed: boolean;
  // CRM 重做新增（后端 buildCustomerRoster 扩展，旧后端无此字段时安全降级）
  source?: 'message' | 'manual' | 'scan' | null;
  last_message?: string | null;
}

interface CustomerListResponse {
  customers: CustomerRow[];
  total: number;
  // 后端按租户 scope 后回的主客服机微信号，供写接口（manage/status/POST/trigger）作目标 key
  cs_wechat_id: string | null;
}

// onboarding 状态机（O1-O5），与后端 crm_onboarding_state 对齐
type OnboardingStepState = 'pending' | 'ok' | 'fail';
interface OnboardingState {
  step_o1_online: OnboardingStepState;
  step_o2_scanned: OnboardingStepState;
  scanned_count: number;
  step_o3_roster: OnboardingStepState;
  blacklist_count: number;
  step_o4_realpublish: OnboardingStepState;
  step_o5_replied: OnboardingStepState;
}

const ONBOARDING_STEPS: { key: keyof OnboardingState; label: string; hint: string }[] = [
  { key: 'step_o1_online', label: 'O1 客服机在线', hint: '客服机已上线 / 绑 license' },
  { key: 'step_o2_scanned', label: 'O2 扫到好友', hint: 'agent 扫近期会话联系人上报' },
  { key: 'step_o3_roster', label: 'O3 名册建好', hint: '默认全接管 + 黑名单初始化' },
  { key: 'step_o4_realpublish', label: 'O4 真发已开', hint: '真发开关打开 + pywinauto 可用' },
  { key: 'step_o5_replied', label: 'O5 真回出去', hint: '首条真回出去 + 真送达确认' },
];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// onboarding 单步圆点：绿(ok)/红(fail)/灰(pending)
function StepDot({ state }: { state: OnboardingStepState }) {
  const color = state === 'ok' ? '#16a34a' : state === 'fail' ? '#dc2626' : '#9ca3af';
  return (
    <span
      data-testid="crm-onboarding-dot"
      data-state={state}
      style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6 }}
    />
  );
}

export default function CustomerListPage() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<CustomerRow[]>([]);
  // 当前运营的主客服机微信号（后端按租户 scope 后回的 cs_wechat_id）。写接口/扫好友/onboarding 以它为目标 key。
  const [csWechatId, setCsWechatId] = useState<string>('');
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [authExpired, setAuthExpired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWechatId, setNewWechatId] = useState('');
  const [scanning, setScanning] = useState(false);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  // 拉客户名册：普通 session fetch，**不带 cs_wechat_id**（后端按 req.tenantId 自动 scope 到本运营客户）。
  // 后端回的 cs_wechat_id = 本租户主客服机号，存下来给写接口作目标 key。
  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await sessionFetch('/api/crm/customers');
      if (res.status === 401) {
        setAuthExpired(true);
        setError('登录已失效，请重新登录');
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error(`加载失败（${res.status}）`);
      const data = (await res.json()) as CustomerListResponse;
      setAuthExpired(false);
      setRows(data.customers ?? []);
      if (data.cs_wechat_id) setCsWechatId(data.cs_wechat_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // onboarding 状态条：按当前主客服机 cs_wechat_id 拉。失败/无客服机时静默（不阻塞列表）。
  const loadOnboarding = useCallback(async (wechatId: string) => {
    if (!wechatId) {
      setOnboarding(null);
      return;
    }
    try {
      const res = await sessionFetch(`/api/crm/onboarding/${encodeURIComponent(wechatId)}`);
      if (!res.ok) {
        setOnboarding(null);
        return;
      }
      const data = (await res.json()) as { onboarding?: OnboardingState } | OnboardingState;
      const ob = (data as { onboarding?: OnboardingState }).onboarding ?? (data as OnboardingState);
      setOnboarding(ob && 'step_o1_online' in ob ? ob : null);
    } catch {
      setOnboarding(null);
    }
  }, []);

  // 首挂载：拉客户名册（后端按租户 scope）。
  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // 拿到主客服机号后 → 拉 onboarding。
  useEffect(() => {
    void loadOnboarding(csWechatId);
  }, [csWechatId, loadOnboarding]);

  // 写接口统一处理：401 → 登录已失效；其它非 2xx → 提示失败；2xx → 返回解析后的 json
  const writeJson = useCallback(
    async (url: string, method: string, body: unknown): Promise<unknown | null> => {
      const res = await sessionFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        setAuthExpired(true);
        flash('登录已失效，请重新登录');
        return null;
      }
      if (!res.ok) {
        flash(`保存失败（${res.status}）`);
        return null;
      }
      setAuthExpired(false);
      return res.json();
    },
    [flash],
  );

  // 接管开关（黑名单语义）：managed=true→接管中；勾掉→managed=false→后端加 blacklist
  const onToggleManage = useCallback(
    async (row: CustomerRow) => {
      const next = !row.managed;
      const out = (await writeJson('/api/crm/customers/manage', 'PUT', {
        wechat_id: csWechatId,
        contact: row.contact,
        managed: next,
      })) as { managed?: boolean; message?: string } | null;
      if (!out) return;
      flash(out.message ?? (next ? '已恢复接管' : '已加入黑名单'));
      await loadCustomers();
    },
    [csWechatId, writeJson, flash, loadCustomers],
  );

  const onChangeStatus = useCallback(
    async (row: CustomerRow, status: CrmStatus) => {
      const out = await writeJson('/api/crm/customers/status', 'PUT', {
        wechat_id: csWechatId,
        contact: row.contact,
        status,
      });
      if (!out) return;
      flash('保存成功');
      await loadCustomers();
    },
    [csWechatId, writeJson, flash, loadCustomers],
  );

  const onAddCustomer = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      flash('请填写客户姓名');
      return;
    }
    const out = await writeJson('/api/crm/customers', 'POST', {
      wechat_id: csWechatId,
      name,
      contact: name,
    });
    if (!out) return;
    setNewName('');
    setNewWechatId('');
    setAdding(false);
    flash('保存成功');
    await loadCustomers();
  }, [newName, csWechatId, writeJson, flash, loadCustomers]);

  // 立即扫好友：通知客服机无视 24h 间隔立刻扫一轮近期会话联系人（POST /friend-scan/trigger）。
  // 用后端回的 cs_wechat_id 作目标；运营单微信场景下名册加载完即就绪。
  const onForceScan = useCallback(async () => {
    if (!csWechatId) {
      flash('客服机还没就绪，请稍候再试');
      return;
    }
    setScanning(true);
    try {
      const out = (await writeJson('/api/crm/friend-scan/trigger', 'POST', {
        cs_wechat_id: csWechatId,
      })) as { ok?: boolean } | null;
      if (!out) return;
      flash('已通知客服机，扫到的好友会自动出现（约几十秒）');
    } finally {
      setScanning(false);
    }
  }, [csWechatId, writeJson, flash]);

  // 点行下钻层2：用 contact 作 key（与 whitelist/should_reply 同字面，§7 决策4）
  const openProfile = useCallback(
    (row: CustomerRow) => {
      const params = new URLSearchParams();
      if (csWechatId) params.set('cs', csWechatId);
      if (row.name && row.name !== row.contact) params.set('name', row.name);
      const qs = params.toString();
      navigate(`/wechat/crm/${encodeURIComponent(row.contact)}${qs ? `?${qs}` : ''}`);
    },
    [csWechatId, navigate],
  );

  return (
    <div className="customer-list-page" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>客户好友表</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 立即扫好友 —— 运营来这儿就是为「采集客户」，做成顶部显眼主按钮 */}
          <button
            data-testid="crm-force-scan-btn"
            onClick={() => void onForceScan()}
            disabled={scanning || !csWechatId}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #2563eb',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: scanning || !csWechatId ? 'not-allowed' : 'pointer',
              opacity: scanning || !csWechatId ? 0.6 : 1,
            }}
            title="让客服机立刻扫一遍微信好友，把客户导进来"
          >
            {scanning ? '通知中…' : '扫一遍微信好友导入客户'}
          </button>
          <button
            data-testid="crm-add-customer-btn"
            onClick={() => setAdding((v) => !v)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', cursor: 'pointer' }}
          >
            ＋加客户
          </button>
        </div>
      </div>

      {/* onboarding 状态条（O1-O5）—— 一眼看到这台客服机走到哪一步、哪步没做 */}
      {onboarding && (
        <div
          data-testid="crm-onboarding-bar"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 16,
            margin: '12px 0',
            padding: '10px 14px',
            background: '#f9fafb',
            border: '1px solid #eee',
            borderRadius: 8,
          }}
        >
          {ONBOARDING_STEPS.map((s) => {
            const state = onboarding[s.key] as OnboardingStepState;
            let extra = '';
            if (s.key === 'step_o2_scanned') extra = `（${onboarding.scanned_count} 人）`;
            if (s.key === 'step_o3_roster') extra = `（黑名单 ${onboarding.blacklist_count} 人）`;
            return (
              <div
                key={s.key}
                data-testid="crm-onboarding-step"
                data-step={s.key}
                title={s.hint}
                style={{ display: 'flex', alignItems: 'center', fontSize: 13, color: '#374151' }}
              >
                <StepDot state={state} />
                {s.label}
                {extra && <span style={{ color: '#9ca3af', marginLeft: 2 }}>{extra}</span>}
              </div>
            );
          })}
        </div>
      )}

      {authExpired && (
        <div role="alert" data-testid="crm-auth-expired" style={{ color: '#b91c1c', margin: '8px 0' }}>
          登录已失效，请重新登录
        </div>
      )}
      {toast && (
        <div data-testid="crm-toast" style={{ color: '#15803d', margin: '8px 0' }}>
          {toast}
        </div>
      )}

      {adding && (
        <div data-testid="crm-add-form" style={{ margin: '12px 0', display: 'flex', gap: 8 }}>
          <input
            data-testid="crm-add-name"
            placeholder="客户姓名/昵称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 6 }}
          />
          <input
            data-testid="crm-add-wechat"
            placeholder="微信号（可空）"
            value={newWechatId}
            onChange={(e) => setNewWechatId(e.target.value)}
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 6 }}
          />
          <button data-testid="crm-add-submit" onClick={() => void onAddCustomer()}>
            入册
          </button>
        </div>
      )}

      {loading ? (
        <div>加载中...</div>
      ) : error && !authExpired ? (
        <div role="alert">错误：{error}</div>
      ) : (
        <>
          <p style={{ color: '#6b7280', margin: '8px 0' }}>
            共 {rows.length} 位好友 · 默认全接管，勾掉「接管中」= 加黑名单（AI 不再回他）
          </p>
          {rows.length === 0 ? (
            <div data-testid="crm-empty">
              暂无好友。等客服机 agent 扫一轮近期会话联系人后会自动出现，也可点上方
              「扫一遍微信好友导入客户」立刻扫，或点「＋加客户」手动入册。
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>姓名</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>状态</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>最后联系</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>接管</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.contact} data-testid="crm-customer-row">
                    <td style={{ padding: 8 }}>
                      <button
                        type="button"
                        data-testid="crm-customer-name"
                        onClick={() => openProfile(row)}
                        title="点开看画像 / 状态 / 聊天记录"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: '#2563eb',
                          cursor: 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                        }}
                      >
                        {row.name}
                      </button>
                      {row.last_message && (
                        <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>{row.last_message}</div>
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <select
                        data-testid="crm-status-select"
                        value={row.status}
                        onChange={(e) => void onChangeStatus(row, e.target.value as CrmStatus)}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>{fmtTime(row.last_contact_at)}</td>
                    <td style={{ padding: 8 }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          data-testid="crm-manage-toggle"
                          checked={row.managed}
                          onChange={() => void onToggleManage(row)}
                        />
                        <span
                          data-testid="crm-manage-label"
                          style={{ fontSize: 12, color: row.managed ? '#15803d' : '#dc2626' }}
                        >
                          {row.managed ? '接管中' : '已排除'}
                        </span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
