import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import {
  listAllLicenses,
  createLicense,
  revokeLicense,
  type Tier,
  type LicenseRow,
} from '../api/license.api';

const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: 'basic', label: 'Basic（1 台）' },
  { value: 'matrix', label: 'Matrix（3 台）' },
  { value: 'studio', label: 'Studio（10 台）' },
  { value: 'enterprise', label: 'Enterprise（30 台）' },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

export default function AdminLicensePage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const [tier, setTier] = useState<Tier>('basic');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [durationDays, setDurationDays] = useState<number>(365);
  const [notes, setNotes] = useState('');
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['license', 'admin-list'],
    queryFn: listAllLicenses,
    enabled: isSuperAdmin,
  });

  const createMut = useMutation({
    mutationFn: createLicense,
    onSuccess: (lic: LicenseRow) => {
      setSubmitMsg(`已生成：${lic.license_key}`);
      setCustomerEmail('');
      setCustomerName('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['license', 'admin-list'] });
    },
    onError: (err: unknown) => {
      const m = err instanceof Error ? err.message : String(err);
      setSubmitMsg(`生成失败：${m}`);
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeLicense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['license', 'admin-list'] });
    },
  });

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: 24, color: '#dc2626' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>403 — 权限不足</h1>
        <p>本页面仅 super-admin 可访问。</p>
      </div>
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitMsg(null);
    createMut.mutate({
      tier,
      customer_email: customerEmail || undefined,
      customer_name: customerName || undefined,
      duration_days: durationDays,
      notes: notes || undefined,
    });
  }

  function handleRevoke(id: string) {
    if (window.confirm('确认吊销该 License？此操作不可逆。')) {
      revokeMut.mutate(id);
    }
  }

  const licenses = listQuery.data?.licenses ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        License 管理（super-admin）
      </h1>

      {/* 创建表单 */}
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#fff',
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          marginBottom: 24,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
        }}
      >
        <label>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
            套餐 / Tier
          </span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            style={inputStyle}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
            客户邮箱 / Email
          </span>
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="customer@example.com"
            style={inputStyle}
          />
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
            客户姓名
          </span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
            有效期（天）
          </span>
          <input
            type="number"
            min={1}
            max={3650}
            value={durationDays}
            onChange={(e) => setDurationDays(parseInt(e.target.value, 10) || 365)}
            style={inputStyle}
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
            备注（可选）
          </span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={inputStyle}
          />
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <button
            type="submit"
            disabled={createMut.isPending}
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: createMut.isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {createMut.isPending ? '创建中…' : '创建 License'}
          </button>
          {submitMsg && (
            <span style={{ marginLeft: 12, fontSize: 14 }}>{submitMsg}</span>
          )}
        </div>
      </form>

      {/* 列表 */}
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        License 列表（{licenses.length}）
      </h2>
      {listQuery.isLoading ? (
        <div>加载中…</div>
      ) : licenses.length === 0 ? (
        <div style={{ padding: 16, color: '#6b7280' }}>暂无 License</div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
          }}
        >
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <Th>License Key</Th>
              <Th>套餐</Th>
              <Th>客户</Th>
              <Th>状态</Th>
              <Th>到期</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <Td>{l.license_key}</Td>
                <Td>{l.tier}</Td>
                <Td>
                  {`${l.customer_name ?? '—'}${l.customer_email ? ` <${l.customer_email}>` : ''}`}
                </Td>
                <Td>{l.status}</Td>
                <Td>{formatDate(l.expires_at)}</Td>
                <Td>
                  {l.status === 'revoked' ? (
                    <span style={{ color: '#9ca3af' }}>已吊销</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRevoke(l.id)}
                      disabled={revokeMut.isPending}
                      style={{
                        padding: '4px 12px',
                        background: '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      吊销
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  marginTop: 4,
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 13,
        color: '#374151',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '10px 12px', fontSize: 14 }}>{children}</td>
  );
}
