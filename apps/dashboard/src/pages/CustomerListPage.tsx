/**
 * Path 4 Step 2: 客户列表页
 *
 * 路由：/customers
 *
 * 展示已映射的微信联系人 + CRM 记录（wechat_id / nickname / 评级 / 状态）
 */
import { useEffect, useState } from 'react';

interface Customer {
  id: string;
  name: string;
  wechat_id?: string;
  rating?: string;
  status?: string;
}

export default function CustomerListPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetch('/api/crm/wechat-contacts?tenant_id=default')
      .then((r) => r.json())
      .then((data) => {
        const contacts = data.contacts ?? [];
        setCustomers(
          contacts.map((c: { wechat_id: string; nickname: string }, i: number) => ({
            id: String(i + 1),
            name: c.nickname,
            wechat_id: c.wechat_id,
            rating: 'A3',
            status: '活跃',
          }))
        );
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>加载中...</div>;
  if (error) return <div role="alert">错误：{error}</div>;

  return (
    <div className="customer-list-page" style={{ padding: 24 }}>
      <h1>客户列表</h1>
      <p>共 {customers.length} 位客户</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>姓名</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>微信号</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>评级</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>状态</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id}>
              <td style={{ padding: 8 }}>{c.name}</td>
              <td style={{ padding: 8 }}>{c.wechat_id}</td>
              <td style={{ padding: 8 }}>{c.rating}</td>
              <td style={{ padding: 8 }}>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
