import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';

export interface Lead {
  commenter_id: string;
  profile_url?: string | null;
  comment_text: string;
  source_video_url: string;
  crawled_at?: string;
  grade: string;
  keyword?: string;
  latest_reply?: string | null;
  latest_reply_at?: string | null;
  assignee?: string | null;
}

interface LeadsTableProps {
  leads: Lead[];
  total?: number;
  loading?: boolean;
}

const GRADE_STYLE: Record<string, string> = {
  高意向: 'bg-red-900/40 text-red-300',
  精准:   'bg-orange-900/40 text-orange-300',
  感兴趣: 'bg-blue-900/40 text-blue-300',
};

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

export default function LeadsTable({ leads, loading }: LeadsTableProps) {
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
      field: 'latest_reply',
      headerName: '最新回复',
      flex: 2,
      minWidth: 180,
      valueFormatter: (p) => (p.value as string | null) ?? '—',
    },
    {
      field: 'assignee',
      headerName: '负责人',
      width: 110,
      valueFormatter: (p) => (p.value as string | null) ?? '—',
    },
    {
      field: 'grade',
      headerName: '评级',
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
          <span className="text-gray-400 text-sm">{loading ? '加载中…' : ''}</span>
        )}
        noRowsOverlayComponent={() => (
          <span className="text-gray-500 text-sm">暂无线索数据</span>
        )}
      />
    </div>
  );
}
