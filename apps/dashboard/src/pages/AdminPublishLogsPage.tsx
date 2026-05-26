import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

interface PublishLog {
  log_id: string;
  work_id: string;
  platform: string;
  status: string;
  created_at: string;
}

interface PublishLogsResponse {
  success: boolean;
  data: PublishLog[];
  total: number;
}

async function fetchPublishLogs(tenant_id: string | null): Promise<PublishLogsResponse> {
  const url = tenant_id
    ? `/api/admin/customers/publish-logs?tenant_id=${encodeURIComponent(tenant_id)}`
    : '/api/admin/customers/publish-logs';
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function AdminPublishLogsPage() {
  const { isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const tenant_id = searchParams.get('tenant_id');

  const query = useQuery<PublishLogsResponse>({
    queryKey: ['admin-publish-logs', tenant_id],
    queryFn: () => fetchPublishLogs(tenant_id),
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

  const logs = query.data?.data ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div style={{ padding: 24, maxWidth: 1280 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        发布日志（publish-logs）
      </h1>
      {tenant_id && (
        <p style={{ color: '#2563eb', fontSize: 13, marginBottom: 8 }}>
          筛选 tenant_id: {tenant_id}
        </p>
      )}
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        总计 {total} 条记录
      </p>

      {query.isLoading ? (
        <div>加载中…</div>
      ) : logs.length === 0 ? (
        <div style={{ padding: 16, color: '#6b7280' }}>暂无数据</div>
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
              <Th>Log ID</Th>
              <Th>Work ID</Th>
              <Th>平台</Th>
              <Th>状态</Th>
              <Th>创建时间</Th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.log_id}
                data-testid="publish-logs-table-row"
                style={{ borderTop: '1px solid #e5e7eb' }}
              >
                <Td>{log.log_id}</Td>
                <Td>{log.work_id}</Td>
                <Td>{log.platform}</Td>
                <Td>{log.status}</Td>
                <Td>{formatDate(log.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
  return <td style={{ padding: '10px 12px', fontSize: 14 }}>{children}</td>;
}
