import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

interface CustomerRow {
  tenant_id: string;
  email: string;
  license_status: 'active' | 'expired' | 'none';
  platform_count: number;
  last_publish_at: string | null;
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

const LICENSE_LABEL: Record<string, string> = {
  active: '有效',
  expired: '已过期',
  none: '无',
};

export default function AdminCustomersPage() {
  const { isSuperAdmin, user } = useAuth();

  const { data, isLoading } = useQuery<CustomersResponse>({
    queryKey: ['admin-customers'],
    queryFn: () => fetchCustomers(user?.email),
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

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div style={{ padding: 24, maxWidth: 1280 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        客户管理（super-admin）
      </h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        总计 {total} 个客户
      </p>

      {isLoading ? (
        <div>加载中…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 16, color: '#6b7280' }}>暂无客户数据</div>
      ) : (
        <table
          data-testid="customers-table"
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
              <Th>Tenant ID</Th>
              <Th>Email</Th>
              <Th>License 状态</Th>
              <Th>平台绑定数</Th>
              <Th>最近发布时间</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tenant_id}
                data-testid="customers-table-row"
                style={{ borderTop: '1px solid #e5e7eb' }}
              >
                <Td>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                    {row.tenant_id}
                  </span>
                </Td>
                <Td>{row.email}</Td>
                <Td>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 12,
                      background:
                        row.license_status === 'active'
                          ? '#d1fae5'
                          : row.license_status === 'expired'
                            ? '#fee2e2'
                            : '#f3f4f6',
                      color:
                        row.license_status === 'active'
                          ? '#065f46'
                          : row.license_status === 'expired'
                            ? '#991b1b'
                            : '#374151',
                    }}
                  >
                    {LICENSE_LABEL[row.license_status] ?? row.license_status}
                  </span>
                </Td>
                <Td>{row.platform_count}</Td>
                <Td>{formatDate(row.last_publish_at)}</Td>
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
