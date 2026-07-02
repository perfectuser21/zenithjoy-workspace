import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';

interface Lead {
  commenter_id: string;
  profile_url?: string | null;
  comment_text: string;
  source_video_url: string;
  crawled_at: string;
  grade: string;
  keyword: string;
}

const VALID_GRADES = ['感兴趣', '精准', '高意向'] as const;
type Grade = (typeof VALID_GRADES)[number] | '';

const GRADE_STYLE: Record<string, string> = {
  高意向: 'bg-red-900/40 text-red-300',
  精准:   'bg-orange-900/40 text-orange-300',
  感兴趣: 'bg-blue-900/40 text-blue-300',
};

// AG Grid quartz-dark CSS 变量（与 CustomerListPage 保持一致）
const AG_THEME: React.CSSProperties = {
  width: '100%',
  height: 560,
  '--ag-background-color':              '#14161f',
  '--ag-foreground-color':              '#eef0f6',
  '--ag-header-background-color':       '#101218',
  '--ag-header-foreground-color':       '#9aa0b2',
  '--ag-border-color':                  '#232734',
  '--ag-row-border-color':              '#1d212c',
  '--ag-row-hover-color':               '#191c27',
  '--ag-selected-row-background-color': 'rgba(227,177,105,.10)',
  '--ag-accent-color':                  '#e3b169',
  '--ag-input-focus-border-color':      '#e3b169',
  '--ag-odd-row-background-color':      '#14161f',
  '--ag-font-family':                   '"Hanken Grotesk","PingFang SC",sans-serif',
  '--ag-font-size':                     '13px',
  '--ag-header-height':                 '44px',
  '--ag-row-height':                    '46px',
  '--ag-border-radius':                 '14px',
  '--ag-wrapper-border-radius':         '16px',
} as React.CSSProperties;

function GradeBadge({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${GRADE_STYLE[value] ?? 'bg-gray-700 text-gray-300'}`}>
      {value}
    </span>
  );
}

function VideoLink({ value }: { value: string }) {
  if (!value) return <span className="text-gray-600">—</span>;
  return (
    <a href={value} target="_blank" rel="noopener noreferrer"
       className="text-blue-400 hover:text-blue-300 hover:underline truncate block max-w-xs">
      {value}
    </a>
  );
}

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

  useEffect(() => { load(gradeFilter); }, [gradeFilter]);

  const columnDefs = useMemo<ColDef<Lead>[]>(() => [
    {
      field: 'commenter_id',
      headerName: '昵称',
      width: 160,
      pinned: 'left',
      cellRenderer: (p: ICellRendererParams<Lead>) => {
        const name = p.value as string;
        const url = p.data?.profile_url;
        if (!name) return <span className="text-gray-600">—</span>;
        if (!url) return <span>{name}</span>;
        return (
          <a href={url} target="_blank" rel="noopener noreferrer"
             className="text-yellow-400 hover:text-yellow-300 hover:underline">
            {name}
          </a>
        );
      },
    },
    {
      field: 'comment_text',
      headerName: '评论内容',
      flex: 2,
      minWidth: 200,
      tooltipField: 'comment_text',
    },
    {
      field: 'grade',
      headerName: '等级',
      width: 100,
      cellRenderer: (p: ICellRendererParams<Lead>) => <GradeBadge value={p.value as string} />,
    },
    {
      field: 'source_video_url',
      headerName: '来源视频',
      flex: 2,
      minWidth: 180,
      cellRenderer: (p: ICellRendererParams<Lead>) => <VideoLink value={p.value as string} />,
    },
    {
      field: 'crawled_at',
      headerName: '时间',
      width: 160,
      valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString('zh-CN') : '—',
    },
    {
      field: 'keyword',
      headerName: '关键词',
      width: 120,
    },
  ], []);

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

      {/* AG Grid 主表格 */}
      <div>
        <div className="ag-theme-quartz-dark" style={AG_THEME}>
          <AgGridReact<Lead>
            rowData={leads}
            columnDefs={columnDefs}
            defaultColDef={{ resizable: true, sortable: true, filter: true }}
            rowHeight={46}
            animateRows={true}
            suppressMovableColumns={false}
            suppressDragLeaveHidesColumns={true}
            loadingOverlayComponent={() => (
              <span className="text-gray-400 text-sm">加载中…</span>
            )}
            noRowsOverlayComponent={() => (
              <span className="text-gray-500 text-sm">暂无线索数据</span>
            )}
          />
        </div>
      </div>
    </div>
  );
}
