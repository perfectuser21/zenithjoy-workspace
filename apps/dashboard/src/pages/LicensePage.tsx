import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyLicense } from '../api/license.api';

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic（1 台）',
  matrix: 'Matrix（3 台）',
  studio: 'Studio（10 台）',
  enterprise: 'Enterprise（30 台）',
};

const STATUS_LABEL: Record<string, string> = {
  active: '生效中',
  expired: '已过期',
  revoked: '已吊销',
  suspended: '已暂停',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso ?? '—';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec} 秒前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)} 天前`;
  return formatDate(iso);
}

export default function LicensePage() {
  const [renewOpen, setRenewOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['license', 'me'],
    queryFn: fetchMyLicense,
  });

  if (isLoading) {
    return <div style={{ padding: 24 }}>加载中…</div>;
  }

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div style={{ padding: 24, color: '#dc2626' }}>加载失败：{msg}</div>
    );
  }

  const license = data?.license ?? null;
  const machines = data?.machines ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        我的 License
      </h1>

      {!license ? (
        <div
          style={{
            padding: 32,
            border: '1px dashed #d1d5db',
            borderRadius: 8,
            textAlign: 'center',
            color: '#6b7280',
          }}
        >
          <p style={{ fontSize: 18, marginBottom: 12 }}>暂无 License</p>
          <p style={{ marginBottom: 16, fontSize: 14 }}>
            如需开通，请联系销售获取 License Key。
          </p>
          <button
            type="button"
            onClick={() => setRenewOpen(true)}
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            申请 License
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: 24,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              marginBottom: 24,
              background: '#fff',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 16,
              }}
            >
              <Field label="套餐" value={TIER_LABEL[license.tier] ?? license.tier} />
              <Field
                label="状态"
                value={STATUS_LABEL[license.status] ?? license.status}
              />
              <Field
                label="已用机器 / 配额"
                value={`${machines.length} / ${license.max_machines}`}
              />
              <Field label="到期日" value={formatDate(license.expires_at)} />
              <Field
                label="License Key"
                value={license.license_key}
              />
              <Field label="客户" value={license.customer_name ?? '—'} />
            </div>
            <div style={{ marginTop: 24, textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setRenewOpen(true)}
                style={{
                  padding: '8px 16px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                申请续费
              </button>
            </div>
          </div>

          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
            已激活机器（{machines.length}）
          </h2>
          {machines.length === 0 ? (
            <div style={{ color: '#6b7280', padding: 16 }}>暂无激活机器</div>
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
                  <Th>主机名</Th>
                  <Th>Machine ID</Th>
                  <Th>上次心跳</Th>
                  <Th>状态</Th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <Td>{m.hostname ?? '—'}</Td>
                    <Td>{m.machine_id}</Td>
                    <Td>{formatRelativeTime(m.last_seen)}</Td>
                    <Td>{m.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {renewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setRenewOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: 32,
              borderRadius: 8,
              maxWidth: 480,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>联系销售开通/续费</h3>
            <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
              请添加微信客服并发送公司名称 + 套餐需求，我们会在 1 个工作日内回复。
            </p>
            <div
              style={{
                background: '#f3f4f6',
                padding: 16,
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 16,
                marginBottom: 16,
              }}
            >
              微信号：ZenithJoy_Sales
            </div>
            <button
              type="button"
              onClick={() => setRenewOpen(false)}
              style={{
                padding: '8px 16px',
                background: '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, color: '#111827' }}>{value}</div>
    </div>
  );
}

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
