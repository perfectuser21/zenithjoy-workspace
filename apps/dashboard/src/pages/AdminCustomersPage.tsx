/**
 * AdminCustomersPage — 合并后的唯一「客户管理」页（#816 结构性去重）
 *
 * 账号模型统一到老的 better-auth 注册用户 + tenant_members（废 tenant_sub_accounts）。
 * 结构：
 *   公司表格（公司名 / License / 成员数，可选中一行）
 *   选中后：① 成员（tenant_members，按 email 拉人 / 移除）
 *           ② 客服-PC 绑定（把成员绑到机器，1:1 双唯一 + 机器配额）
 *           ③ 诊断报告（复用 module-health）
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';
import {
  listMembers,
  addMemberByEmail,
  removeMember,
  listServiceAgents,
  bindDevice,
  updateCompanyName,
  type MemberRole,
} from '../api/customer-admin.api';
import { fetchModuleHealth } from '../api/moduleHealth.api';

interface CustomerRow {
  tenant_id: string;
  name?: string;
  email: string;
  member_count?: number;
  license_status?: string;
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

const ROLE_OPTIONS: MemberRole[] = ['member', 'admin', 'owner'];

export default function AdminCustomersPage() {
  const { isSuperAdmin, user } = useAuth();
  const email = user?.email;
  const qc = useQueryClient();

  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<MemberRole>('member');
  const [bindMember, setBindMember] = useState('');
  const [bindMachine, setBindMachine] = useState('');
  const [diagMachine, setDiagMachine] = useState('');
  const [err, setErr] = useState('');

  const { data: customers } = useQuery<CustomersResponse>({
    queryKey: ['admin-customers'],
    queryFn: () => fetchCustomers(email),
    enabled: isSuperAdmin,
  });

  const tenantId = selectedTenant ?? customers?.data?.[0]?.tenant_id ?? null;

  const { data: members } = useQuery({
    queryKey: ['tenant-members', tenantId],
    queryFn: () => listMembers(tenantId!, email),
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

  const memberRows = members?.data ?? [];
  const healthRows = health?.data ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1280 }} data-testid="customer-admin-page">
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>客户管理（super-admin）</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        公司 / 成员 / 客服-PC 绑定 / 诊断 一站式后台
      </p>
      {err && (
        <div data-testid="error-banner" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* ───────── 公司表格 ───────── */}
      <Section title="公司" testId="region-companies">
        <table data-testid="companies-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <Th>公司名</Th>
              <Th>License</Th>
              <Th>成员数</Th>
              <Th>改公司名</Th>
            </tr>
          </thead>
          <tbody>
            {(customers?.data ?? []).map((c) => {
              const selected = c.tenant_id === tenantId;
              return (
                <tr
                  key={c.tenant_id}
                  data-testid="company-row"
                  onClick={() => {
                    setSelectedTenant(c.tenant_id);
                    setCompanyName('');
                  }}
                  style={{
                    borderTop: '1px solid #e5e7eb',
                    cursor: 'pointer',
                    background: selected ? '#eff6ff' : undefined,
                  }}
                >
                  <Td>
                    <span data-testid="company-name">{c.name?.trim() ? c.name : '(未命名)'}</span>
                  </Td>
                  <Td>{c.license_status ?? 'none'}</Td>
                  <Td>
                    <span data-testid="company-member-count">{c.member_count ?? 0}</span>
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        data-testid="company-name-input"
                        placeholder="新公司名"
                        value={selected ? companyName : ''}
                        onChange={(ev) => {
                          setSelectedTenant(c.tenant_id);
                          setCompanyName(ev.target.value);
                        }}
                        style={{ width: 140 }}
                      />
                      <button
                        data-testid="company-name-save"
                        disabled={!selected || !companyName.trim()}
                        onClick={() =>
                          run(async () => {
                            await updateCompanyName(c.tenant_id, companyName.trim(), email);
                            setCompanyName('');
                          })
                        }
                      >
                        保存
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* ───────── ① 成员 ───────── */}
      <Section title="① 成员（注册用户 + tenant_members）" testId="region-members">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            data-testid="member-email-input"
            placeholder="按 email 拉用户进本公司"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
          />
          <select
            data-testid="member-role-select"
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value as MemberRole)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            data-testid="member-add"
            disabled={!tenantId || !memberEmail.trim()}
            onClick={() =>
              run(
                async () => {
                  await addMemberByEmail(tenantId!, memberEmail.trim(), memberRole, email);
                  setMemberEmail('');
                },
                'tenant-members'
              )
            }
          >
            拉成员进公司
          </button>
        </div>
        <table data-testid="members-list" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {memberRows.map((m) => (
              <tr key={m.user_id} data-testid="member-row" style={{ borderTop: '1px solid #e5e7eb' }}>
                <Td>{m.email}</Td>
                <Td>
                  <span
                    data-testid="member-role-tag"
                    style={{ padding: '2px 8px', background: '#eef2ff', borderRadius: 999, fontSize: 12 }}
                  >
                    {m.role}
                  </span>
                </Td>
                <Td>
                  <button
                    data-testid="member-remove"
                    onClick={() => run(() => removeMember(tenantId!, m.user_id, email), 'tenant-members', 'tenant-bindings')}
                  >
                    移除
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ───────── ② 客服-PC 绑定 ───────── */}
      <Section title="② 客服-PC 绑定" testId="region-bindings">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <select data-testid="bind-member-select" value={bindMember} onChange={(e) => setBindMember(e.target.value)}>
            <option value="">选择成员</option>
            {memberRows.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.email}
              </option>
            ))}
          </select>
          <input data-testid="bind-machine-input" placeholder="机器 ID" value={bindMachine} onChange={(e) => setBindMachine(e.target.value)} />
          <button
            data-testid="bind-submit"
            disabled={!tenantId || !bindMember || !bindMachine.trim()}
            onClick={() =>
              run(
                async () => {
                  await bindDevice(tenantId!, bindMember, bindMachine.trim(), email);
                  setBindMachine('');
                  setBindMember('');
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
                  成员 {b.member_email ?? b.member_user_id} @ PC {b.machine_id}{' '}
                  <span data-testid="binding-online" style={{ color: b.online ? '#16a34a' : '#9ca3af' }}>
                    {b.online ? '● 在线' : '○ 离线'}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ───────── ③ 诊断报告 ───────── */}
      <Section title="③ 诊断报告" testId="region-diagnosis">
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

function Td({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler<HTMLTableCellElement> }) {
  return <td onClick={onClick} style={{ padding: '8px 12px', fontSize: 14 }}>{children}</td>;
}
