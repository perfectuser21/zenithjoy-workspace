import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';
import {
  listAccounts,
  createAccount,
  deleteAccount,
  listServiceAgents,
  bindDevice,
  updateCompanyName,
  type SubAccountRole,
} from '../api/customer-admin.api';
import { fetchModuleHealth } from '../api/moduleHealth.api';

interface CustomerRow {
  tenant_id: string;
  email: string;
  name?: string;
}

interface CustomersResponse {
  success: boolean;
  data: CustomerRow[];
  total: number;
}

async function fetchCustomers(email?: string): Promise<CustomersResponse> {
  const res = await adminFetch('/api/admin/customers', email);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const ROLE_OPTIONS: SubAccountRole[] = ['admin', 'operator', 'service_agent'];

export default function AdminCustomersPage() {
  const { isSuperAdmin, user } = useAuth();
  const email = user?.email;
  const qc = useQueryClient();

  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [acctEmail, setAcctEmail] = useState('');
  const [acctDisplay, setAcctDisplay] = useState('');
  const [acctRole, setAcctRole] = useState<SubAccountRole>('service_agent');
  const [bindAccount, setBindAccount] = useState('');
  const [bindMachine, setBindMachine] = useState('');
  const [diagMachine, setDiagMachine] = useState('');
  const [err, setErr] = useState('');

  const { data: customers } = useQuery<CustomersResponse>({
    queryKey: ['admin-customers'],
    queryFn: () => fetchCustomers(email),
    enabled: isSuperAdmin,
  });

  const tenantId = selectedTenant ?? customers?.data?.[0]?.tenant_id ?? null;

  const { data: accounts } = useQuery({
    queryKey: ['tenant-accounts', tenantId],
    queryFn: () => listAccounts(tenantId!, email),
    enabled: isSuperAdmin && !!tenantId,
  });

  const { data: bindings } = useQuery({
    queryKey: ['tenant-bindings', tenantId],
    queryFn: () => listServiceAgents(tenantId!, email),
    enabled: isSuperAdmin && !!tenantId,
  });

  const { data: health } = useQuery({
    queryKey: ['module-health'],
    queryFn: () => fetchModuleHealth(),
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: 24, color: '#dc2626' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>403 — 权限不足</h1>
        <p>本页面仅 super-admin 可访问。</p>
      </div>
    );
  }

  async function run(fn: () => Promise<unknown>, ...keys: string[]) {
    setErr('');
    try {
      await fn();
      for (const k of keys) await qc.invalidateQueries({ queryKey: [k, tenantId] });
      await qc.invalidateQueries({ queryKey: ['admin-customers'] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    }
  }

  const serviceAgentAccounts = (accounts?.data ?? []).filter((a) => a.role === 'service_agent');
  const healthRows = health?.data ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1280 }} data-testid="customer-admin-page">
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>客户管理（super-admin）</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        公司 / 子账号 / 客服-PC 绑定 / 诊断 一站式后台
      </p>
      {err && (
        <div data-testid="error-banner" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* ───────── 区 1：公司 ───────── */}
      <Section title="① 公司" testId="region-company">
        <div style={{ marginBottom: 12 }}>
          <select
            data-testid="company-select"
            value={tenantId ?? ''}
            onChange={(e) => {
              setSelectedTenant(e.target.value);
              setCompanyName('');
              setSavedName('');
            }}
          >
            {(customers?.data ?? []).map((c) => (
              <option key={c.tenant_id} value={c.tenant_id}>
                {c.name || c.email || c.tenant_id}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            data-testid="company-name-input"
            placeholder="公司名"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <button
            data-testid="company-name-save"
            disabled={!tenantId || !companyName.trim()}
            onClick={() =>
              run(async () => {
                const out = await updateCompanyName(tenantId!, companyName.trim(), email);
                setSavedName(out.name);
              })
            }
          >
            保存公司名
          </button>
          {savedName && (
            <span data-testid="company-name-display" style={{ color: '#065f46' }}>
              当前公司名：{savedName}
            </span>
          )}
        </div>
      </Section>

      {/* ───────── 区 2：子账号 ───────── */}
      <Section title="② 子账号" testId="region-accounts">
        <p style={{ fontSize: 12, color: '#6b7280' }} data-testid="accounts-quota">
          配额：{accounts?.quota?.used ?? 0}/{accounts?.quota?.limit ?? 0}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input data-testid="account-email" placeholder="邮箱" value={acctEmail} onChange={(e) => setAcctEmail(e.target.value)} />
          <input data-testid="account-display" placeholder="显示名" value={acctDisplay} onChange={(e) => setAcctDisplay(e.target.value)} />
          <select data-testid="account-role" value={acctRole} onChange={(e) => setAcctRole(e.target.value as SubAccountRole)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            data-testid="account-add"
            disabled={!tenantId || !acctEmail.trim()}
            onClick={() =>
              run(
                async () => {
                  await createAccount(
                    tenantId!,
                    { email: acctEmail.trim(), display_name: acctDisplay.trim(), role: acctRole },
                    email
                  );
                  setAcctEmail('');
                  setAcctDisplay('');
                },
                'tenant-accounts'
              )
            }
          >
            新增账号
          </button>
        </div>
        <table data-testid="accounts-list" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {(accounts?.data ?? []).map((a) => (
              <tr key={a.account_id} data-testid="account-row" style={{ borderTop: '1px solid #e5e7eb' }}>
                <Td>{a.email}</Td>
                <Td>{a.display_name}</Td>
                <Td>
                  <span data-testid="account-role-tag" style={{ padding: '2px 8px', background: '#eef2ff', borderRadius: 999, fontSize: 12 }}>
                    {a.role}
                  </span>
                </Td>
                <Td>
                  <button
                    data-testid="account-delete"
                    onClick={() => run(() => deleteAccount(tenantId!, a.account_id, email), 'tenant-accounts', 'tenant-bindings')}
                  >
                    删除
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ───────── 区 3：客服-PC 绑定 ───────── */}
      <Section title="③ 客服-PC 绑定" testId="region-bindings">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <select data-testid="bind-account-select" value={bindAccount} onChange={(e) => setBindAccount(e.target.value)}>
            <option value="">选择客服账号</option>
            {serviceAgentAccounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.email}
              </option>
            ))}
          </select>
          <input data-testid="bind-machine-input" placeholder="机器 ID" value={bindMachine} onChange={(e) => setBindMachine(e.target.value)} />
          <button
            data-testid="bind-submit"
            disabled={!tenantId || !bindAccount || !bindMachine.trim()}
            onClick={() =>
              run(
                async () => {
                  await bindDevice(tenantId!, bindAccount, bindMachine.trim(), email);
                  setBindMachine('');
                  setBindAccount('');
                },
                'tenant-bindings'
              )
            }
          >
            绑定
          </button>
        </div>
        <table data-testid="bindings-list" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {(bindings?.data ?? []).map((b) => (
              <tr key={b.binding_id} data-testid="binding-row" style={{ borderTop: '1px solid #e5e7eb' }}>
                <Td>
                  客服 {b.account_email} @ PC {b.machine_id}{' '}
                  <span data-testid="binding-online" style={{ color: b.online ? '#16a34a' : '#9ca3af' }}>
                    {b.online ? '● 在线' : '○ 离线'}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ───────── 区 4：诊断报告 ───────── */}
      <Section title="④ 诊断报告" testId="region-diagnosis">
        <div style={{ marginBottom: 12 }}>
          <select data-testid="diagnosis-machine-select" value={diagMachine} onChange={(e) => setDiagMachine(e.target.value)}>
            <option value="">选择客户机</option>
            {healthRows.map((h) => (
              <option key={h.agent_id} value={h.agent_id}>
                {h.hostname || h.agent_id}
              </option>
            ))}
          </select>
        </div>
        {healthRows.length === 0 ? (
          <div data-testid="diagnosis-empty" style={{ color: '#6b7280' }}>
            该机暂无上报，请确认 Agent 已连中台
          </div>
        ) : (
          <table data-testid="diagnosis-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <Th>机器</Th>
                <Th>模块</Th>
                <Th>状态</Th>
                <Th>原因</Th>
              </tr>
            </thead>
            <tbody>
              {healthRows
                .filter((h) => !diagMachine || h.agent_id === diagMachine)
                .flatMap((h) =>
                  Object.entries(h.module_status).map(([mod, st]) => (
                    <tr key={`${h.agent_id}-${mod}`} data-testid="diagnosis-row" style={{ borderTop: '1px solid #e5e7eb' }}>
                      <Td>{h.hostname || h.agent_id}</Td>
                      <Td>{mod}</Td>
                      <Td>{st.ok ? '✅' : '❌'}</Td>
                      <Td>{st.reason ?? '—'}</Td>
                    </tr>
                  ))
                )}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section
      data-testid={testId}
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 13, color: '#374151' }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '8px 12px', fontSize: 14 }}>{children}</td>;
}
