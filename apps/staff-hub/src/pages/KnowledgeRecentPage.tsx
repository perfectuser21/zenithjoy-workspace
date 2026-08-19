import { useEffect, useState } from 'react';
import { knowledgeJson, KnowledgeRequestError } from '../lib/knowledgeFetch';

interface KnowledgeEntry {
  entry_id: string;
  trigger_condition: string;
  conclusion: string;
  evidence_url: string;
  org_id: string;
  created_at: string;
}

interface RecentPayload {
  items: KnowledgeEntry[];
  count: number;
}

/**
 * 「最近沉淀」—— 读实时源（Cecelia 账本），只显本组织。
 *
 * 三种失败各有各的文案与 testid，绝不退化成一个空列表：空列表会被读成「还没人沉淀过」，
 * 于是一次会话失效或账本不可达看起来和「确实是空的」一模一样，没人会去查。
 */
export default function KnowledgeRecentPage() {
  const [items, setItems] = useState<KnowledgeEntry[] | null>(null);
  const [failure, setFailure] = useState<KnowledgeRequestError | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await knowledgeJson<RecentPayload>('/api/staff/knowledge/recent');
        if (!cancelled) setItems(data.items);
      } catch (err) {
        if (!cancelled) setFailure(err as KnowledgeRequestError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure) {
    const testId =
      failure.code === 'SESSION_REQUIRED'
        ? 'knowledge-session-expired'
        : failure.code === 'LEDGER_UNREACHABLE'
          ? 'knowledge-ledger-unreachable'
          : 'knowledge-forbidden';
    return (
      <div className="page">
        <h1>最近沉淀</h1>
        <p data-testid={testId} style={{ color: '#d64545' }}>
          {failure.message}
        </p>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="page">
        <h1>最近沉淀</h1>
        <p data-testid="knowledge-loading" className="muted">
          加载中…
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>最近沉淀</h1>
      <p className="muted" data-testid="knowledge-recent-count">
        本组织共 {items.length} 条
      </p>
      {items.length === 0 ? (
        <p data-testid="knowledge-recent-empty" className="muted">
          还没有沉淀，去「沉淀经验」写第一条。
        </p>
      ) : (
        <ul style={{ display: 'grid', gap: '12px', listStyle: 'none', padding: 0 }}>
          {items.map((entry) => (
            <li key={entry.entry_id} data-testid={`knowledge-entry-${entry.entry_id}`} className="card">
              <div style={{ fontWeight: 700 }}>{entry.conclusion}</div>
              <div className="muted" style={{ margin: '6px 0' }}>
                触发条件：{entry.trigger_condition}
              </div>
              <a href={entry.evidence_url} target="_blank" rel="noreferrer">
                {entry.evidence_url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
