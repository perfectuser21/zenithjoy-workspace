/**
 * CustomerListPage — Line04 中台 AI-native CRM·客户列表页
 *
 * 路由：/customers
 *
 * 一屏管客户：姓名 | 微信号 | 状态(A1-A5 下拉) | 最后联系时间 | 接管开关。
 * 名册读 GET /api/crm/customers（租户闸，按登录态 scope）；勾接管开关写 whitelist；
 * 下拉改状态持久化；+加客户手动入册。
 *
 * 所有 CRM fetch 都带 `credentials: 'include'` —— 修「未登录」bug：浏览器须带 better-auth
 * session cookie，否则后端 tenantContext 401。写接口返 401 → 提示「登录已失效，请重新登录」。
 */
import { useCallback, useEffect, useState } from 'react';

type CrmStatus = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

const STATUS_OPTIONS: CrmStatus[] = ['A1', 'A2', 'A3', 'A4', 'A5'];

interface CustomerRow {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: CrmStatus;
  last_contact_at: string | null;
  managed: boolean;
}

interface CustomerListResponse {
  customers: CustomerRow[];
  total: number;
  cs_wechat_id: string | null;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export default function CustomerListPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [csWechatId, setCsWechatId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [authExpired, setAuthExpired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWechatId, setNewWechatId] = useState('');

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/crm/customers', { credentials: 'include' });
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
      setCsWechatId(data.cs_wechat_id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  // 写接口统一处理：401 → 登录已失效；其它非 2xx → 提示失败；2xx → 返回解析后的 json
  const writeJson = useCallback(
    async (url: string, method: string, body: unknown): Promise<unknown | null> => {
      const res = await fetch(url, {
        method,
        credentials: 'include',
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

  const onToggleManage = useCallback(
    async (row: CustomerRow) => {
      const out = (await writeJson('/api/crm/customers/manage', 'PUT', {
        wechat_id: csWechatId,
        contact: row.contact,
        managed: !row.managed,
      })) as { managed?: boolean; message?: string } | null;
      if (!out) return;
      flash(out.message ?? '保存成功');
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

  return (
    <div className="customer-list-page" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>客户列表</h1>
        <button
          data-testid="crm-add-customer-btn"
          onClick={() => setAdding((v) => !v)}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', cursor: 'pointer' }}
        >
          ＋加客户
        </button>
      </div>

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
          <p style={{ color: '#6b7280', margin: '8px 0' }}>共 {rows.length} 位客户</p>
          {rows.length === 0 ? (
            <div data-testid="crm-empty">暂无已聊客户，可点「＋加客户」预先入册。</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>姓名</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>微信号</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>状态</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>最后联系</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>接管</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.contact} data-testid="crm-customer-row">
                    <td style={{ padding: 8 }} data-testid="crm-customer-name">
                      {row.name}
                    </td>
                    <td style={{ padding: 8 }}>{row.wechat_id ?? '—'}</td>
                    <td style={{ padding: 8 }}>
                      <select
                        data-testid="crm-status-select"
                        value={row.status}
                        onChange={(e) => void onChangeStatus(row, e.target.value as CrmStatus)}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>{fmtTime(row.last_contact_at)}</td>
                    <td style={{ padding: 8 }}>
                      <input
                        type="checkbox"
                        data-testid="crm-manage-toggle"
                        checked={row.managed}
                        onChange={() => void onToggleManage(row)}
                      />
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
