import React, { useEffect, useState } from 'react';

interface MomentDraft {
  id: string;
  task_id: string;
  customer: string;
  content: string;
  approval_status: string;
  approval_source: string | null;
  scheduled_at: string | null;
  created_at: string;
}

export default function MomentDraftReviewPage() {
  const [drafts, setDrafts] = useState<MomentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrafts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/wechat/moment-drafts');
      const data = await res.json();
      setDrafts(data.drafts || []);
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleApprove = async (taskId: string) => {
    await fetch(`/api/wechat/moment-drafts/${taskId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    fetchDrafts();
  };

  const handleReject = async (taskId: string) => {
    await fetch(`/api/wechat/moment-drafts/${taskId}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    fetchDrafts();
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ padding: '24px' }}>
      <h1>朋友圈草稿审核</h1>
      {drafts.length === 0 ? (
        <p>暂无待审核草稿</p>
      ) : (
        <div>
          {drafts.map((draft) => (
            <div key={draft.id} style={{ border: '1px solid #eee', padding: '16px', marginBottom: '16px', borderRadius: '8px' }}>
              <div><strong>客户：</strong>{draft.customer}</div>
              <div style={{ margin: '8px 0' }}><strong>文案：</strong>{draft.content}</div>
              <div><strong>状态：</strong>{draft.approval_status}</div>
              <div><strong>生成时间：</strong>{new Date(draft.created_at).toLocaleString('zh-CN')}</div>
              {draft.approval_status === 'pending_review' && (
                <div style={{ marginTop: '12px' }}>
                  <button onClick={() => handleApprove(draft.task_id)} style={{ marginRight: '8px', padding: '6px 16px', background: '#52c41a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    批准
                  </button>
                  <button onClick={() => handleReject(draft.task_id)} style={{ padding: '6px 16px', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    拒绝
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
