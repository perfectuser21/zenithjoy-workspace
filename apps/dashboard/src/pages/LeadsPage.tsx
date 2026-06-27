import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Search } from 'lucide-react';

interface Lead {
  commenter_id: string;
  comment_text: string;
  source_video_url: string;
  crawled_at: string;
  grade: string;
  keyword: string;
}

// ── Path 2 Step4 采集闭环（飞书企业信息文档 → 扩词 → 派单 → 状态）──
interface ExpandKeyword {
  word: string;
  source: 'ai' | 'manual' | 'seed';
}
interface CollectLead {
  sec_uid: string | null;
  nickname: string;
  profile_url: string | null;
  partial: boolean;
}
interface CollectStatus {
  task_id: string;
  status: string;
  video_count: number;
  lead_count_raw: number;
  lead_count_deduped: number;
  error_code: string | null;
  degraded: boolean;
  leads: CollectLead[];
}

const VALID_GRADES = ['感兴趣', '精准', '高意向'] as const;
type Grade = (typeof VALID_GRADES)[number] | '';

const GRADE_STYLE: Record<string, string> = {
  高意向: 'bg-red-100 text-red-800',
  精准: 'bg-orange-100 text-orange-800',
  感兴趣: 'bg-blue-100 text-blue-800',
};

async function fetchLeads(grade: string): Promise<{ leads: Lead[]; total: number }> {
  const params = grade ? `?grade=${encodeURIComponent(grade)}` : '';
  const res = await fetch(`/api/acquisition/leads${params}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ leads: Lead[]; total: number }>;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [gradeFilter, setGradeFilter] = useState<Grade>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 采集闭环状态 ──
  const [acqPhase, setAcqPhase] = useState<'idle' | 'expanded' | 'dispatched'>('idle');
  const [acqKeywords, setAcqKeywords] = useState<ExpandKeyword[]>([]);
  const [acqDegraded, setAcqDegraded] = useState(false);
  const [acqTaskId, setAcqTaskId] = useState<string | null>(null);
  const [acqStatus, setAcqStatus] = useState<CollectStatus | null>(null);
  const [acqError, setAcqError] = useState<string | null>(null);
  const acqPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleCollect = async () => {
    setAcqError(null);
    try {
      const res = await fetch('/api/acquisition/collect/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setAcqError(body?.error?.code || `HTTP ${res.status}`);
        return;
      }
      setAcqKeywords(body.data.keywords as ExpandKeyword[]);
      setAcqDegraded(Boolean(body.data.degraded));
      setAcqPhase('expanded');
    } catch (e) {
      setAcqError((e as Error).message);
    }
  };

  const handleConfirm = async () => {
    setAcqError(null);
    try {
      const res = await fetch('/api/acquisition/collect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: acqKeywords.map((k) => k.word) }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setAcqError(body?.error?.code || `HTTP ${res.status}`);
        return;
      }
      setAcqTaskId(body.data.task_id as string);
      setAcqPhase('dispatched');
    } catch (e) {
      setAcqError((e as Error).message);
    }
  };

  // 派单后轮询任务状态（持续轮询直到组件卸载，让 7 态/计数/失败原因实时刷新）
  useEffect(() => {
    if (!acqTaskId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/acquisition/collect/${acqTaskId}`);
        const body = await res.json();
        if (res.ok && body.success) setAcqStatus(body.data as CollectStatus);
      } catch {
        /* 轮询失败忽略，下次再试 */
      }
    };
    poll();
    acqPollRef.current = setInterval(poll, 1500);
    return () => {
      if (acqPollRef.current) clearInterval(acqPollRef.current);
    };
  }, [acqTaskId]);

  const load = async (grade: Grade) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeads(grade);
      setLeads(data.leads);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(gradeFilter);
  }, [gradeFilter]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">获客 Leads</h1>
        <div className="flex items-center gap-3">
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value as Grade)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">全部等级</option>
            {VALID_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <button
            onClick={() => load(gradeFilter)}
            disabled={loading}
            className="flex items-center gap-1 border rounded px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>
      )}

      {/* ── Path 2 Step4 采集闭环面板 ── */}
      <div className="mb-6 p-4 border rounded-lg bg-white">
        <div className="flex items-center gap-3 mb-3">
          <button
            data-testid="acq-collect-button"
            onClick={handleCollect}
            className="flex items-center gap-1 bg-blue-600 text-white rounded px-4 py-1.5 text-sm hover:bg-blue-700"
          >
            <Search size={14} />
            采集
          </button>
          <span className="text-sm text-gray-500">读企业信息文档 → 扩词 → 派客户机采集抖音号</span>
        </div>

        {acqError && (
          <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-xs" data-testid="acq-expand-error">
            {acqError}
          </div>
        )}

        {acqPhase !== 'idle' && acqKeywords.length > 0 && (
          <div data-testid="acq-expand-result" className="mb-3">
            <div className="text-sm font-medium mb-1">
              扩词结果{acqDegraded && <span className="ml-2 text-orange-600 text-xs">降级</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {acqKeywords.map((k, i) => (
                <span
                  key={i}
                  data-testid="acq-expand-keyword"
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-sm"
                >
                  {k.word}
                  <span data-testid="acq-keyword-source" className="text-xs text-gray-400">
                    {k.source}
                  </span>
                </span>
              ))}
              <button
                data-testid="acq-confirm-button"
                onClick={handleConfirm}
                className="ml-2 bg-green-600 text-white rounded px-3 py-1 text-xs hover:bg-green-700"
              >
                确认派单
              </button>
            </div>
          </div>
        )}

        {acqPhase === 'dispatched' && acqStatus && (
          <div data-testid="acq-task-status" className="mt-2 text-sm">
            <div className="flex flex-wrap gap-4 items-center">
              <span>
                状态：<b data-testid="acq-status-value">{acqStatus.status}</b>
              </span>
              <span data-testid="acq-video-count">视频数：{acqStatus.video_count}</span>
              <span data-testid="acq-lead-count-raw">去重前：{acqStatus.lead_count_raw}</span>
              <span data-testid="acq-lead-count-deduped">去重后：{acqStatus.lead_count_deduped}</span>
              {acqStatus.error_code && (
                <span data-testid="acq-error-code" className="text-red-600">
                  失败原因：{acqStatus.error_code}
                </span>
              )}
            </div>
            <ul className="mt-2 space-y-1">
              {acqStatus.leads.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span>{l.nickname}</span>
                  {l.profile_url ? (
                    <a
                      data-testid="acq-lead-profile-link"
                      href={l.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs"
                    >
                      抖音主页
                    </a>
                  ) : (
                    <span data-testid="acq-lead-partial-badge" className="text-xs text-orange-600">
                      残缺/待核
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="text-sm text-gray-500 mb-2">共 {total} 条</div>

      <div className="overflow-x-auto">
        <table
          data-testid="leads-table"
          className="w-full border-collapse text-sm"
        >
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-2 border-b font-medium">抖音号</th>
              <th className="text-left px-4 py-2 border-b font-medium">评论内容</th>
              <th className="text-left px-4 py-2 border-b font-medium">等级</th>
              <th className="text-left px-4 py-2 border-b font-medium">来源视频</th>
              <th className="text-left px-4 py-2 border-b font-medium">时间</th>
              <th className="text-left px-4 py-2 border-b font-medium">关键词</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  {loading ? '加载中...' : '暂无数据'}
                </td>
              </tr>
            ) : (
              leads.map((lead, idx) => (
                <tr key={idx} className="hover:bg-gray-50 border-b">
                  <td className="px-4 py-2">{lead.commenter_id}</td>
                  <td className="px-4 py-2 max-w-xs truncate">{lead.comment_text}</td>
                  <td className="px-4 py-2">
                    <span
                      data-testid="grade-badge"
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        GRADE_STYLE[lead.grade] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {lead.grade}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {lead.source_video_url ? (
                      <a
                        href={lead.source_video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate block max-w-xs"
                      >
                        {lead.source_video_url}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {lead.crawled_at ? new Date(lead.crawled_at).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="px-4 py-2">{lead.keyword}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
