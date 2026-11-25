import { useEffect, useState } from 'react';

const API = '/api/company-profile/source-sync';
const labels = { notion: 'Notion', feishu: '飞书' };
const tableLabels = { products: '产品', audiences: '客户画像', keywords: '关键词' };
type Platform = keyof typeof labels;
type Source = { platform: Platform; parent: string };
type SyncState = {
  platform?: Platform;
  draft_id?: string;
  base_version?: number;
  applied_version?: number;
  fetched_at?: string;
  applied_at?: string;
  preview?: {
    products: string[];
    audiences: string[];
    keywords: { word: string; enabled: boolean }[];
    rows?: { table: keyof typeof tableLabels; title: string; fields: Record<string, string> }[];
  };
};

async function request<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(API + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const reply = await response.json().catch(() => null);
  if (!response.ok || !reply?.success) throw Error(reply?.error?.message ?? '无法读取资料同步，请重试');
  return reply.data;
}

export default function CompanySourceSync({ onApplied }: { onApplied: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [state, setState] = useState<SyncState>({});
  const [platform, setPlatform] = useState<Platform>();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    request<{ sources: Source[]; state: SyncState }>().then(data => {
      if (!mounted) return;
      setSources(data.sources);
      setState(data.state);
      setPlatform(data.state.platform ?? data.sources[0]?.platform);
    }).catch(error => {
      if (mounted) setMessage(error.message);
    }).finally(() => {
      if (mounted) setBusy(false);
    });
    return () => { mounted = false; };
  }, []);

  async function sync(action: 'preview' | 'apply') {
    if (busy || !platform) return;
    setBusy(true);
    setMessage('');
    try {
      const data = await request<SyncState>('/' + action, action === 'preview' ? { platform } : { draft_id: state.draft_id });
      setState(data);
      if (action === 'apply') {
        setMessage(`已同步，当前公司资料版本 v${data.applied_version}。`);
        onApplied();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同步失败');
    } finally {
      setBusy(false);
    }
  }

  const preview = platform === state.platform ? state.preview : undefined;
  return (
    <section aria-label="客户资料同步" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>客户资料同步</h2>
      <p style={{ margin: 0 }}>从已登记的工作台读取产品、客户画像和关键词。确认启用后，新任务使用更新的资料。</p>
      {busy && <p role="status">正在读取或同步资料…</p>}
      {!busy && !sources.length && !message && <p>当前公司还没有已登记的 Notion 或飞书工作台。</p>}
      {!!sources.length && <>
        <label>
          资料来源{' '}
          <select value={platform ?? ''} disabled={busy} onChange={event => setPlatform(event.target.value as Platform)}>
            {sources.map(source => <option key={source.platform} value={source.platform}>{labels[source.platform]}</option>)}
          </select>
        </label>
        <div><button type="button" disabled={busy || !platform} onClick={() => void sync('preview')}>拉取同步预览</button></div>
      </>}
      {preview && <div>
        <h3>同步预览</h3>
        <p>产品（{preview.products.length}）{preview.products.join('、')}</p>
        <p>客户画像（{preview.audiences.length}）{preview.audiences.join('、')}</p>
        <p>关键词（{preview.keywords.length}）{preview.keywords.map(keyword => `${keyword.word}${keyword.enabled ? '' : '（停用）'}`).join('、')}</p>
        {!!preview.rows?.length && <details>
          <summary>查看字段</summary>
          {preview.rows.map((row, index) => <dl key={index}>
            <dt>{tableLabels[row.table]} · {row.title}</dt>
            {Object.entries(row.fields).map(([field, value]) => <dd key={field}>{field} · {value || '空'}</dd>)}
          </dl>)}
        </details>}
        <button type="button" disabled={busy} onClick={() => void sync('apply')}>确认并启用</button>
      </div>}
      {state.applied_at && <p>最近同步 {new Date(state.applied_at).toLocaleString()} · v{state.applied_version}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
