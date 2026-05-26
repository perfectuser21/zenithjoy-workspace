import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

interface PlatformSession {
  session_id: string;
  platform: string;
  status: 'active' | 'expired';
  expires_at: string | null;
}

interface PlatformSessionsResponse {
  success: boolean;
  data: PlatformSession[];
  total: number;
}

async function fetchPlatformSessions(email?: string): Promise<PlatformSessionsResponse> {
  const res = await adminFetch('/api/admin/customers/platform-sessions', email);
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

export default function AdminPlatformSessionsPage() {
  const { isSuperAdmin, user } = useAuth();

  const query = useQuery<PlatformSessionsResponse>({
    queryKey: ['admin-platform-sessions'],
    queryFn: () => fetchPlatformSessions(user?.email),
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

  const sessions = query.data?.data ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div style={{ padding: 24, maxWidth: 1280 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        平台绑定状态（platform-sessions）
      </h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        总计 {total} 条记录
      </p>

      {query.isLoading ? (
        <div>加载中…</div>
      ) : sessions.length === 0 ? (
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
              <Th>Session ID</Th>
              <Th>平台</Th>
              <Th>状态</Th>
              <Th>到期时间</Th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const normalizedStatus: 'active' | 'expired' =
                s.status === 'active' ? 'active' : 'expired';
              return (
                <tr
                  key={s.session_id}
                  data-testid="platform-sessions-table-row"
                  style={{ borderTop: '1px solid #e5e7eb' }}
                >
                  <Td>{s.session_id}</Td>
                  <Td>{s.platform}</Td>
                  <Td>
                    <span
                      data-testid="session-status"
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 12,
                        background: normalizedStatus === 'active' ? '#dcfce7' : '#fee2e2',
                        color: normalizedStatus === 'active' ? '#15803d' : '#991b1b',
                      }}
                    >
                      {normalizedStatus}
                    </span>
                  </Td>
                  <Td>{formatDate(s.expires_at)}</Td>
                </tr>
              );
            })}
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
