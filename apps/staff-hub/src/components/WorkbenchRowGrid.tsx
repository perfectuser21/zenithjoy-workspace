/**
 * 表格视图 —— AG Grid 32.2.1 承载行内编辑（路③ Sprint B / S2）
 *
 * 三条不可让步的交互纪律（合同「失败语义声明」逐条）：
 *  1. **写回以服务端返回的整行 + 递增后的 version 回填**，不是前端本地乐观值，也不是整表重拉。
 *     整表重拉正是 `CustomerListPage` 的病根：失败的那一格会被旧值盖回去，看起来像
 *     "保存成功后又被改回来了"。
 *  2. **写回失败（5xx / 断网）时原输入留在编辑器里**，单元格进可见错误态并给一个就地重试，
 *     用户不用重打。禁乐观回滚静默、禁全量重拉掩盖失败。
 *  3. **409 冲突时不覆盖用户输入、也不自动重拉**：进冲突态给出可见提示，
 *     要不要拿对方的值由用户点「重新读取该行」决定。
 *
 * 编辑态住在本组件的一处 state（同一时刻只有一格在编辑），通过 React context 下发给
 * AG Grid 的 cellRenderer —— 不放进 cellRenderer 自己的 local state：AG Grid 会因为
 * 行数据更新重建 cell 组件，local state 一重建就没了，"原输入还在"当场作废。
 */
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type React from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import {
  parseCellInput,
  patchRow,
  WorkbenchRequestError,
  type CellValue,
  type WorkbenchField,
  type WorkbenchRow,
} from '../lib/workbenchFetch';

type Draft = string | string[];

interface ActiveCell {
  rowId: string;
  fieldId: string;
  draft: Draft;
  status: 'editing' | 'saving' | 'error' | 'conflict';
  message: string;
}

/** relation 字段的渲染元数据：目标表 id + 目标 row_id → 标题映射（页面预取候选后下发）。 */
export interface RelationMeta {
  targetTableId: string;
  titleByRow: Record<string, string>;
}

interface CellContextValue {
  active: ActiveCell | null;
  beginEdit: (rowId: string, field: WorkbenchField, value: CellValue) => void;
  setDraft: (draft: Draft) => void;
  commit: () => void;
  reread: (rowId: string) => void;
  expand: (rowId: string) => void;
  remove: (rowId: string) => void;
  relationMeta: Record<string, RelationMeta>;
  relationEdit: (rowId: string, field: WorkbenchField) => void;
  relationJump: (targetTableId: string, targetRowId: string) => void;
}

const CellContext = createContext<CellContextValue | null>(null);

/** 展示态文本：多选拼顿号，空值给一个占位，别让空单元格看起来像"这一列坏了" */
function displayOf(value: CellValue): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join('、');
  return String(value);
}

function draftOf(value: CellValue): Draft {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined) return '';
  return String(value);
}

function CellEditor({ field, active }: { field: WorkbenchField; active: ActiveCell }) {
  const ctx = useContext(CellContext)!;
  const testId = `cell-editor-${active.rowId}-${field.field_id}`;
  const common = {
    'data-testid': testId,
    autoFocus: true,
    onBlur: () => ctx.commit(),
    // Enter / Tab 也提交：AG Grid 自己接管了表格里的 Tab 导航，光靠 onBlur 会有"按了 Tab
    // 焦点却没离开输入框、于是压根没写回"的死角（真浏览器实测到的，不是理论上的）。
    // commit 内部对 saving 态直接 return，所以"键盘提交 + 随后失焦"不会写两次。
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        ctx.commit();
      }
    },
    className: 'cell-editor',
  };

  if (field.field_type === 'single_select') {
    return (
      <select {...common} value={String(active.draft)} onChange={(e) => ctx.setDraft(e.target.value)}>
        <option value="">（清空）</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.field_type === 'multi_select') {
    const selected = Array.isArray(active.draft) ? active.draft : [];
    return (
      <select
        {...common}
        multiple
        value={selected}
        onChange={(e) => ctx.setDraft(Array.from(e.target.selectedOptions).map((o) => o.value))}
      >
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      {...common}
      type={field.field_type === 'date' ? 'date' : 'text'}
      value={Array.isArray(active.draft) ? active.draft.join('') : active.draft}
      onChange={(e) => ctx.setDraft(e.target.value)}
    />
  );
}

/** relation 单元格：把关联的目标 row_id 渲染成可点跳转的标题 chip + 一个「配置关联」入口。 */
function RelationCell({ rowId, field, value }: { rowId: string; field: WorkbenchField; value: CellValue }) {
  const ctx = useContext(CellContext)!;
  const fieldId = field.field_id ?? '';
  const cellId = `cell-${rowId}-${fieldId}`;
  const meta = ctx.relationMeta[fieldId];
  const ids = Array.isArray(value) ? value.map((v) => String(v)) : [];
  return (
    <div data-testid={cellId} className="grid-cell grid-cell-relation">
      {ids.length === 0 && <span className="rel-empty">—</span>}
      {ids.map((id) => {
        // 失效判定：候选元数据已加载（meta 存在）但该 row_id 不在其中 = 目标记录被软删/移出可读集。
        // 数据层仍保留 row_id 数组（删错可还原，和 A30② 删表语义一致）；展示层示以失效标记，
        // 不显示旧标题、不给可跳转入口（点了也不会跳到已删记录的 404 白屏）。
        const title = meta?.titleByRow[id];
        const isStale = meta !== undefined && title === undefined;
        if (isStale) {
          return (
            <span
              key={id}
              className="rel-chip rel-chip-stale"
              data-testid={`rel-chip-stale-${rowId}-${fieldId}-${id}`}
              title="关联的记录已被删除"
            >
              记录已删除
            </span>
          );
        }
        return (
          <button
            key={id}
            type="button"
            className="rel-chip"
            data-testid={`rel-chip-${rowId}-${fieldId}-${id}`}
            title="点击跳转到关联记录"
            onClick={() => meta && ctx.relationJump(meta.targetTableId, id)}
          >
            {title ?? id}
          </button>
        );
      })}
      <button
        type="button"
        className="rel-edit"
        data-testid={`rel-edit-${rowId}-${fieldId}`}
        onClick={() => ctx.relationEdit(rowId, field)}
      >
        配置关联
      </button>
    </div>
  );
}

function RowCell({ rowId, field, value }: { rowId: string; field: WorkbenchField; value: CellValue }) {
  const ctx = useContext(CellContext)!;
  if (field.field_type === 'relation') return <RelationCell rowId={rowId} field={field} value={value} />;
  const cellId = `cell-${rowId}-${field.field_id}`;
  const active =
    ctx.active && ctx.active.rowId === rowId && ctx.active.fieldId === field.field_id ? ctx.active : null;

  if (!active) {
    return (
      <div
        data-testid={cellId}
        className="grid-cell"
        title="双击编辑"
        onDoubleClick={() => ctx.beginEdit(rowId, field, value)}
      >
        {displayOf(value)}
      </div>
    );
  }

  return (
    <div data-testid={cellId} className={`grid-cell grid-cell-${active.status}`}>
      <CellEditor field={field} active={active} />
      {active.status === 'error' && (
        <span className="cell-note cell-note-error">
          <span data-testid={`cell-error-${rowId}-${field.field_id}`}>{active.message}</span>
          <button
            type="button"
            data-testid={`cell-retry-${rowId}-${field.field_id}`}
            // 按下时不让输入框先失焦：失焦会再触发一次写回，重试就成了"重试两次"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctx.commit()}
          >
            重试
          </button>
        </span>
      )}
      {active.status === 'conflict' && (
        <span className="cell-note cell-note-conflict">
          <span data-testid={`cell-conflict-${rowId}-${field.field_id}`}>{active.message}</span>
          <button
            type="button"
            data-testid={`cell-reread-${rowId}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctx.reread(rowId)}
          >
            重新读取该行
          </button>
        </span>
      )}
    </div>
  );
}

export interface WorkbenchRowGridProps {
  fields: WorkbenchField[];
  rows: WorkbenchRow[];
  /** 写回成功：拿服务端返回的整行（含新 version）就地回填，不整表刷新 */
  onRowSaved: (row: WorkbenchRow) => void;
  /** 写回撞上 404：该行已被他人删除，交给页面出可见提示 */
  onRowGone: (rowId: string) => void;
  /** 冲突后用户显式点「重新读取该行」才去取对方的值 */
  onReread: (rowId: string) => void;
  onExpand: (rowId: string) => void;
  /** 删行走软删，页面负责刷新行回收站 */
  onDelete: (rowId: string) => void;
  /** 剪贴板 TSV 原文；解析与落库由页面统一处理 */
  onPasteText: (text: string) => void;
  /** relation 字段渲染元数据（页面预取候选后下发：目标表 id + row_id→标题） */
  relationMeta?: Record<string, RelationMeta>;
  /** 打开某行某 relation 字段的行选择器（配置关联） */
  onRelationEdit?: (rowId: string, field: WorkbenchField) => void;
  /** 点关联项 → 跳转到目标表该记录 */
  onRelationJump?: (targetTableId: string, targetRowId: string) => void;
}

export default function WorkbenchRowGrid({
  fields,
  rows,
  onRowSaved,
  onRowGone,
  onReread,
  onExpand,
  onDelete,
  onPasteText,
  relationMeta = {},
  onRelationEdit,
  onRelationJump,
}: WorkbenchRowGridProps) {
  const [active, setActive] = useState<ActiveCell | null>(null);
  const activeRef = useRef<ActiveCell | null>(null);
  const rowsRef = useRef<WorkbenchRow[]>(rows);
  const fieldsRef = useRef<WorkbenchField[]>(fields);
  activeRef.current = active;
  rowsRef.current = rows;
  fieldsRef.current = fields;

  const apply = useCallback((next: ActiveCell | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const beginEdit = useCallback(
    (rowId: string, field: WorkbenchField, value: CellValue) => {
      apply({
        rowId,
        fieldId: field.field_id ?? '',
        draft: draftOf(value),
        status: 'editing',
        message: '',
      });
    },
    [apply]
  );

  const setDraft = useCallback(
    (draft: Draft) => {
      const cur = activeRef.current;
      if (!cur) return;
      apply({ ...cur, draft, status: cur.status === 'saving' ? 'saving' : 'editing', message: '' });
    },
    [apply]
  );

  const commit = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur || cur.status === 'saving') return;
    const row = rowsRef.current.find((r) => r.row_id === cur.rowId);
    const field = fieldsRef.current.find((f) => f.field_id === cur.fieldId);
    if (!row || !field) return;
    apply({ ...cur, status: 'saving', message: '' });
    try {
      const saved = await patchRow(cur.rowId, row.version, {
        [cur.fieldId]: parseCellInput(field.field_type, cur.draft),
      });
      apply(null);
      onRowSaved(saved);
    } catch (e) {
      const err = e instanceof WorkbenchRequestError ? e : null;
      if (err?.status === 404) {
        apply(null);
        onRowGone(cur.rowId);
        return;
      }
      if (err?.code === 'ROW_VERSION_CONFLICT') {
        apply({ ...cur, status: 'conflict', message: err.message });
        return;
      }
      apply({
        ...cur,
        status: 'error',
        message: err ? err.message : '写回失败，改动未保存（可就地重试）',
      });
    }
  }, [apply, onRowGone, onRowSaved]);

  const reread = useCallback(
    (rowId: string) => {
      apply(null);
      onReread(rowId);
    },
    [apply, onReread]
  );

  const ctxValue = useMemo<CellContextValue>(
    () => ({
      active,
      beginEdit,
      setDraft,
      commit,
      reread,
      expand: onExpand,
      remove: onDelete,
      relationMeta,
      relationEdit: (rowId, field) => onRelationEdit?.(rowId, field),
      relationJump: (t, r) => onRelationJump?.(t, r),
    }),
    [active, beginEdit, setDraft, commit, reread, onExpand, onDelete, relationMeta, onRelationEdit, onRelationJump]
  );

  const columnDefs = useMemo<ColDef<WorkbenchRow>[]>(() => {
    const expandCol: ColDef<WorkbenchRow> = {
      colId: '__expand',
      headerName: '',
      width: 128,
      sortable: false,
      cellRenderer: (p: ICellRendererParams<WorkbenchRow>) => (
        <RowOpsCell rowId={p.data?.row_id ?? ''} />
      ),
    };
    return [
      expandCol,
      ...fields.map<ColDef<WorkbenchRow>>((f) => ({
        colId: f.field_id ?? f.name,
        headerName: f.name,
        minWidth: 160,
        flex: 1,
        sortable: false,
        valueGetter: (p) => (p.data ? (p.data.data[f.field_id ?? ''] ?? null) : null),
        cellRenderer: (p: ICellRendererParams<WorkbenchRow>) => (
          <RowCell
            rowId={p.data?.row_id ?? ''}
            field={f}
            value={(p.data?.data[f.field_id ?? ''] ?? null) as CellValue}
          />
        ),
      })),
    ];
  }, [fields]);

  return (
    <CellContext.Provider value={ctxValue}>
      {/* 单元格宽度有限，失败原因在格子里会被裁掉半句。原因是"用户必须看得懂发生了什么"的
          载体，不能只存在于一个被裁剪的角落，所以同一条消息在表格上方整句再出一次。 */}
      {active && (active.status === 'error' || active.status === 'conflict') && (
        <div className={`grid-banner grid-banner-${active.status}`} data-testid="cell-status-banner">
          {active.message}
        </div>
      )}
      <div
        data-testid="row-grid"
        className="ag-theme-quartz workbench-grid"
        style={{ width: '100%', height: 460 }}
        onPaste={(e) => {
          const text = e.clipboardData?.getData('text/plain') ?? '';
          if (!text) return;
          e.preventDefault();
          onPasteText(text);
        }}
      >
        <AgGridReact<WorkbenchRow>
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.row_id}
          rowHeight={64}
          headerHeight={40}
          // 八列全量渲染：列虚拟化会让右侧几列不进 DOM，"每一格都能被点到"就不成立了
          suppressColumnVirtualisation
          suppressCellFocus
          animateRows={false}
        />
      </div>
    </CellContext.Provider>
  );
}

function RowOpsCell({ rowId }: { rowId: string }) {
  const ctx = useContext(CellContext)!;
  return (
    <span className="row-ops">
      <button type="button" data-testid={`row-expand-${rowId}`} onClick={() => ctx.expand(rowId)}>
        展开
      </button>
      <button type="button" data-testid={`row-delete-${rowId}`} onClick={() => ctx.remove(rowId)}>
        删除
      </button>
    </span>
  );
}
