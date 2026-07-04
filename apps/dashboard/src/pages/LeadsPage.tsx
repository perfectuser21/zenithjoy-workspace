import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import LeadsTable, { type Lead } from '../components/LeadsTable';

const VALID_GRADES = ['感兴趣', '精准', '高意向'] as const;
type Grade = (typeof VALID_GRADES)[number] | '';

async function fetchLeads(grade: string): Promise<{ leads: Lead[]; total: number }> {
  const params = grade ? `?grade=${encodeURIComponent(grade)}` : '';
  const res = await fetch(`/api/acquisition/leads${params}`);
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

  useEffect(() => { load(gradeFilter); }, [gradeFilter]);

  return (
    <div className="flex flex-col p-4 gap-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-xl font-semibold text-white">获客 Leads</h1>
        <div className="flex items-center gap-3">
          {/* 等级快筛 */}
          <div className="flex gap-1">
            {(['', ...VALID_GRADES] as Grade[]).map((g) => (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  gradeFilter === g
                    ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-600/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {g || '全部'}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(gradeFilter)}
            disabled={loading}
            className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="flex-shrink-0 p-3 bg-red-900/30 text-red-400 rounded text-sm">{error}</div>
      )}

      {/* 数量 */}
      <div className="flex-shrink-0 text-xs text-gray-500">共 {total} 条</div>

      {/* Leads 表格（共用组件） */}
      <LeadsTable leads={leads} total={total} loading={loading} />
    </div>
  );
}
