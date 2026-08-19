import { useState } from 'react';
import { knowledgeJson, KnowledgeRequestError } from '../lib/knowledgeFetch';

interface EntryCreated {
  entry_id: string;
  org_id: string;
  created_at: string;
}

/**
 * 经验录入页 —— 三个字段：什么情况下（触发条件）、结论是什么、证据在哪。
 *
 * 证据链接是必填的：一条没有证据的"经验"没法被后来人复核，沉淀下来的是意见不是经验。
 * 提交失败一定带原因码文案（不是笼统的"提交失败"），因为三种失败要走三条不同的路：
 * 会话失效 → 重新登录；没有归属 → 找管理员配员工目录；账本不可达 → 稍后重试。
 */
export default function KnowledgeNewPage() {
  const [triggerCondition, setTriggerCondition] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const data = await knowledgeJson<EntryCreated>('/api/staff/knowledge/entries', {
        method: 'POST',
        body: JSON.stringify({
          trigger_condition: triggerCondition,
          conclusion,
          evidence_url: evidenceUrl,
        }),
      });
      setResult({ ok: true, text: `已沉淀，条目 ${data.entry_id}` });
      setTriggerCondition('');
      setConclusion('');
      setEvidenceUrl('');
    } catch (err) {
      const e2 = err as KnowledgeRequestError;
      setResult({ ok: false, text: `未沉淀（${e2.code}）：${e2.message}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1>沉淀一条经验</h1>
      <p className="muted">写清「什么情况下」「结论是什么」「证据在哪」，同事下次遇到同样的坑能直接用。</p>

      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: '12px', maxWidth: '720px' }}>
        <label>
          触发条件
          <textarea
            data-testid="knowledge-trigger-condition"
            value={triggerCondition}
            onChange={(e) => setTriggerCondition(e.target.value)}
            rows={3}
            placeholder="什么情况下会遇到这件事"
          />
        </label>
        <label>
          结论
          <textarea
            data-testid="knowledge-conclusion"
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            rows={4}
            placeholder="结论是什么、下次该怎么做"
          />
        </label>
        <label>
          证据链接
          <input
            data-testid="knowledge-evidence-url"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://…（PR / 日志 / 截图）"
          />
        </label>
        <button className="button" type="submit" data-testid="knowledge-submit" disabled={submitting}>
          {submitting ? '提交中…' : '提交'}
        </button>
      </form>

      {result && (
        <p
          data-testid="knowledge-submit-result"
          style={{ marginTop: '16px', color: result.ok ? '#1f7a3d' : '#d64545' }}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
