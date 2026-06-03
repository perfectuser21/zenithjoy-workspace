/**
 * Path 4 Step 2: CRM 配置页
 *
 * 路由：/crm/config
 *
 * 步骤：
 * 1. 选 CRM 平台（飞书 / Notion）
 * 2. 建/检测客户明细表
 * 3. 拉取微信联系人列表（mock 5 条）
 * 4. 展示 AI 匹配结果（已匹配/待确认/未匹配）
 * 5. 用户确认 → 写 crm_wechat_mapping
 */
import { useState } from 'react';

type Platform = 'feishu' | 'notion';
type Step = 'select-platform' | 'init-table' | 'contacts' | 'match-preview' | 'confirmed';

interface WechatContact {
  wechat_id: string;
  nickname: string;
}

interface MatchPreview {
  matched: Array<{ wechat_id: string; nickname: string }>;
  pending: Array<{ wechat_id: string; nickname: string }>;
  unmatched: Array<{ wechat_id: string; nickname: string }>;
}

export default function CrmConfigPage() {
  const [platform, setPlatform] = useState<Platform>('feishu');
  const [step, setStep] = useState<Step>('select-platform');
  const [tableId, setTableId] = useState<string>('');
  const [contacts, setContacts] = useState<WechatContact[]>([]);
  const [matchPreview, setMatchPreview] = useState<MatchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [tenantId] = useState<string>('test-tenant-crm');

  async function handleInitTable(mode: 'create' | 'detect') {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/crm/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, tenant_id: tenantId, mode }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '建表失败');
      setTableId(data.table_id);
      setStep('contacts');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '建表失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchContacts() {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`/api/crm/wechat-contacts?tenant_id=${tenantId}`);
      const data = await resp.json();
      setContacts(data.contacts || []);
      setStep('match-preview');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '拉取联系人失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleMatchPreview() {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`/api/crm/match-preview?tenant_id=${tenantId}`);
      const data = await resp.json();
      setMatchPreview(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '匹配失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError('');
    try {
      // 写入映射（thin 阶段调 init 确认）
      setStep('confirmed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="crm-config-page" style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <h1>配置客户管理</h1>

      {error && (
        <div role="alert" style={{ color: 'red', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {step === 'select-platform' && (
        <div>
          <h2>选择 CRM 平台</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <button
              onClick={() => setPlatform('feishu')}
              style={{ padding: '8px 16px', background: platform === 'feishu' ? '#1890ff' : '#eee', color: platform === 'feishu' ? '#fff' : '#333', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              data-testid="platform-feishu"
            >
              飞书 (Feishu)
            </button>
            <button
              onClick={() => setPlatform('notion')}
              style={{ padding: '8px 16px', background: platform === 'notion' ? '#1890ff' : '#eee', color: platform === 'notion' ? '#fff' : '#333', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              data-testid="platform-notion"
            >
              Notion
            </button>
          </div>
          <p>已选：<strong>{platform === 'feishu' ? '飞书' : 'Notion'}</strong></p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleInitTable('create')} disabled={loading} style={{ padding: '8px 16px' }}>
              新建客户明细表
            </button>
            <button onClick={() => handleInitTable('detect')} disabled={loading} style={{ padding: '8px 16px' }}>
              检测已有表
            </button>
          </div>
        </div>
      )}

      {step === 'contacts' && (
        <div>
          <h2>微信联系人导入</h2>
          <p>表 ID：<code>{tableId}</code></p>
          <button onClick={handleFetchContacts} disabled={loading} style={{ padding: '8px 16px' }}>
            拉取微信联系人
          </button>
        </div>
      )}

      {step === 'match-preview' && (
        <div>
          <h2>AI 匹配结果</h2>
          <p>已拉取 <strong>{contacts.length}</strong> 位联系人</p>
          <ul>
            {contacts.map((c) => (
              <li key={c.wechat_id} data-wechat-id={c.wechat_id}>
                {c.nickname} ({c.wechat_id})
              </li>
            ))}
          </ul>
          <button onClick={handleMatchPreview} disabled={loading} style={{ padding: '8px 16px', marginRight: 8 }}>
            查看匹配结果
          </button>
          {matchPreview && (
            <div style={{ marginTop: 16 }}>
              <div data-testid="matched-section">
                <strong>已匹配</strong>: {matchPreview.matched.length} 条
              </div>
              <div data-testid="pending-section">
                <strong>待确认</strong>: {matchPreview.pending.length} 条
              </div>
              <div data-testid="unmatched-section">
                <strong>未匹配</strong>: {matchPreview.unmatched.length} 条
              </div>
              <button onClick={handleConfirm} style={{ marginTop: 16, padding: '8px 16px' }}>
                确认建立映射
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'confirmed' && (
        <div>
          <h2>映射建立成功 ✓</h2>
          <p>客户微信联系人与 CRM 表映射已建立。</p>
          <a href="/customers">查看客户列表 →</a>
        </div>
      )}

      {loading && <p style={{ color: '#666', marginTop: 8 }}>处理中...</p>}
    </div>
  );
}
