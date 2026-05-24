import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

interface Lead {
  commenter_id: string;
  comment_text: string;
  source_video_url: string;
  crawled_at: string;
  grade: string;
  keyword: string;
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
