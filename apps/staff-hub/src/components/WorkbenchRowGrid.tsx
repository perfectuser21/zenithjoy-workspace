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
 *
 * UI 呈现层（Notion 级重做）：每种 field_type 有专属图标 + 专属显示/编辑器，
 * 列头带类型图标，行悬浮出操作，空表给引导 —— 但一个字节的写回语义都不动。
 */
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type React from 'react';
import { createPortal } from 'react-dom';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, IHeaderParams } from 'ag-grid-community';
import {
  parseCellInput,
  patchRow,
  WorkbenchRequestError,
  type CellValue,
  type WorkbenchField,
  type WorkbenchRow,
} from '../lib/workbenchFetch';
import { FieldIcon, fieldTypeLabel, personBadge, tagColor } from '../lib/workbenchFieldMeta';

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

/** 一个 rollup/lookup 单元格的读时聚合值（页面预取 /rollups 后下发）。 */
export interface RollupCellMeta {
  value: number | string | null;
  degraded: boolean;
  fn: string;
}
/** rollupMeta：field_id → row_id → 聚合值。读时计算不落库，单元格只读渲染。 */
export type RollupMeta = Record<string, Record<string, RollupCellMeta>>;

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
  rollupMeta: RollupMeta;
}

const CellContext = createContext<CellContextValue | null>(null);

function draftOf(value: CellValue): Draft {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined) return '';
  return String(value);
}

function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 一枚柔和标签（单选/多选/关联共用的视觉原子）。 */
function Tag({ label, dot = false }: { label: string; dot?: boolean }) {
  const c = tagColor(label);
  return (
    <span className="wb-tag" style={{ background: c.bg, color: c.fg }}>
      {dot && <span className="wb-tag-dot" style={{ background: c.dot }} />}
      {label}
    </span>
  );
}

/** 空单元格的占位：一个极淡的破折号，不喧宾夺主但也不会读成"这列坏了"。 */
function EmptyDash() {
  return <span className="wb-cell-empty">—</span>;
}

/** 按 field_type 分发的只读显示。 */
function CellDisplay({ field, value }: { field: WorkbenchField; value: CellValue }) {
  if (isEmpty(value)) return <EmptyDash />;
  switch (field.field_type) {
    case 'number':
      return <span className="wb-cell-number">{String(value)}</span>;
    case 'url': {
      const href = String(value);
      const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
      return (
        <a
          className="wb-cell-url"
          href={safe}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
        >
          <FieldIcon type="url" className="wb-inline-ico" />
          {href}
        </a>
      );
    }
    case 'date':
      return <span className="wb-cell-date">{String(value)}</span>;
    case 'single_select':
      return <Tag label={String(value)} dot />;
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : [String(value)];
      return (
        <span className="wb-tags">
          {arr.map((v) => (
            <Tag key={v} label={String(v)} dot />
          ))}
        </span>
      );
    }
    case 'person': {
      const arr = Array.isArray(value) ? value : [String(value)];
      return (
        <span className="wb-persons">
          {arr.map((v) => {
            const b = personBadge(String(v));
            return (
              <span className="wb-person" key={v}>
                <span className="wb-avatar" style={{ background: b.color.dot }}>
                  {b.initial}
                </span>
                {String(v)}
              </span>
            );
          })}
        </span>
      );
    }
    case 'long_text':
      return <span className="wb-cell-longtext">{String(value)}</span>;
    default:
      return <span className="wb-cell-text">{String(value)}</span>;
  }
}

/**
 * 定位在锚点下方的浮层（用 portal 挂到 body，彻底跳出 AG Grid 的 overflow 裁剪与层叠）。
 * 单选/多选的彩色标签下拉、以及失败/冲突的就地提示都借它逃出格子。
 */
function Popover({
  anchor,
  onDismiss,
  className,
  children,
}: {
  anchor: HTMLElement | null;
  onDismiss: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && anchor && !anchor.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onDismiss]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className={`wb-popover${className ? ` ${className}` : ''}`}
      style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
    >
      {children}
    </div>,
    document.body
  );
}

/** 单选/多选的彩色标签下拉编辑器（Notion 招牌）。 */
function SelectPopoverEditor({
  field,
  active,
  anchor,
}: {
  field: WorkbenchField;
  active: ActiveCell;
  anchor: HTMLElement | null;
}) {
  const ctx = useContext(CellContext)!;
  const multi = field.field_type === 'multi_select';
  const selected = Array.isArray(active.draft) ? active.draft : active.draft ? [String(active.draft)] : [];

  const pick = (opt: string) => {
    if (multi) {
      const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt];
      ctx.setDraft(next);
    } else {
      ctx.setDraft(opt);
      ctx.commit();
    }
  };

  return (
    <Popover anchor={anchor} onDismiss={() => ctx.commit()} className="wb-select-pop">
      <div className="wb-select-scroll">
        {!multi && (
          <button type="button" className="wb-select-opt" onClick={() => pick('')}>
            <span className="wb-select-clear">清空</span>
          </button>
        )}
        {field.options.map((o) => {
          const on = selected.includes(o);
          return (
            <button type="button" key={o} className={`wb-select-opt${on ? ' on' : ''}`} onClick={() => pick(o)}>
              <Tag label={o} dot />
              {on && <span className="wb-select-check">✓</span>}
            </button>
          );
        })}
        {field.options.length === 0 && <div className="wb-select-none">该字段还没有选项</div>}
      </div>
      {multi && (
        <button type="button" className="wb-select-done" onClick={() => ctx.commit()}>
          完成
        </button>
      )}
    </Popover>
  );
}

function CellEditor({
  field,
  active,
  anchor,
}: {
  field: WorkbenchField;
  active: ActiveCell;
  anchor: HTMLElement | null;
}) {
  const ctx = useContext(CellContext)!;
  const testId = `cell-editor-${active.rowId}-${field.field_id}`;

  if (field.field_type === 'single_select' || field.field_type === 'multi_select') {
    // 锚点仍带 testid（保留可定位性）；真正的选项在 portal 浮层里。
    return (
      <div className="wb-inline-editor" data-testid={testId}>
        <span className="wb-inline-editor-anchor">
          {Array.isArray(active.draft) && active.draft.length > 0 ? (
            active.draft.map((v) => <Tag key={v} label={String(v)} dot />)
          ) : active.draft && !Array.isArray(active.draft) ? (
            <Tag label={String(active.draft)} dot />
          ) : (
            <span className="wb-cell-empty">选择…</span>
          )}
        </span>
        <SelectPopoverEditor field={field} active={active} anchor={anchor} />
      </div>
    );
  }

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
    className: 'wb-input cell-editor',
  };

  return (
    <input
      {...common}
      type={field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'text' : 'text'}
      inputMode={field.field_type === 'number' ? 'decimal' : undefined}
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
      {ids.length === 0 && <span className="rel-empty wb-cell-empty">—</span>}
      {ids.map((id) => {
        // 失效判定：候选元数据已加载（meta 存在）但该 row_id 不在其中 = 目标记录被软删/移出可读集。
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
            <FieldIcon type="relation" className="wb-inline-ico" />
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

/**
 * rollup / lookup 单元格：读时计算的聚合值，**只读**（不接受用户输入、无编辑器）。
 * 依赖失效或含非数值跳过 → degraded → 显示可见降级占位（不显示旧值、不白屏）。
 */
function RollupCell({ rowId, field }: { rowId: string; field: WorkbenchField }) {
  const ctx = useContext(CellContext)!;
  const fieldId = field.field_id ?? '';
  const cellId = `cell-${rowId}-${fieldId}`;
  const meta = ctx.rollupMeta[fieldId]?.[rowId];
  if (meta && meta.degraded && (meta.value === null || meta.value === undefined)) {
    return (
      <div data-testid={cellId} className="grid-cell grid-cell-rollup grid-cell-rollup-degraded">
        <span
          className="rollup-degraded wb-badge-degraded"
          data-testid={`rollup-degraded-${rowId}-${fieldId}`}
          title="汇总依赖已失效"
        >
          汇总已失效
        </span>
      </div>
    );
  }
  const empty = meta === undefined || meta.value === null || meta.value === '';
  return (
    <div data-testid={cellId} className="grid-cell grid-cell-rollup">
      <span className="rollup-value wb-cell-rollup" data-testid={`rollup-value-${rowId}-${fieldId}`}>
        {empty ? <EmptyDash /> : String(meta!.value)}
      </span>
      {meta?.degraded && (
        <span
          className="rollup-degraded-badge wb-badge-warn"
          data-testid={`rollup-degraded-${rowId}-${fieldId}`}
          title="部分行未计入"
        >
          !
        </span>
      )}
    </div>
  );
}

function RowCell({ rowId, field, value }: { rowId: string; field: WorkbenchField; value: CellValue }) {
  const ctx = useContext(CellContext)!;
  // callback ref → state：portal 浮层要在挂载后才拿得到锚元素做定位，普通 ref 不会触发重渲染
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  if (field.field_type === 'relation') return <RelationCell rowId={rowId} field={field} value={value} />;
  if (field.field_type === 'rollup' || field.field_type === 'lookup')
    return <RollupCell rowId={rowId} field={field} />;
  const cellId = `cell-${rowId}-${field.field_id}`;
  const active =
    ctx.active && ctx.active.rowId === rowId && ctx.active.fieldId === field.field_id ? ctx.active : null;

  if (!active) {
    return (
      <div
        data-testid={cellId}
        className={`grid-cell wb-display grid-cell-type-${field.field_type}`}
        title="双击编辑"
        onDoubleClick={() => ctx.beginEdit(rowId, field, value)}
      >
        <CellDisplay field={field} value={value} />
      </div>
    );
  }

  return (
    <div ref={setAnchorEl} data-testid={cellId} className={`grid-cell wb-editing grid-cell-${active.status}`}>
      <CellEditor field={field} active={active} anchor={anchorEl} />
      {active.status === 'error' && (
        <Popover anchor={anchorEl} onDismiss={() => undefined} className="wb-note-pop wb-note-error">
          <span className="cell-note cell-note-error">
            <span data-testid={`cell-error-${rowId}-${field.field_id}`}>{active.message}</span>
            <button
              type="button"
              className="wb-note-btn"
              data-testid={`cell-retry-${rowId}-${field.field_id}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ctx.commit()}
            >
              重试
            </button>
          </span>
        </Popover>
      )}
      {active.status === 'conflict' && (
        <Popover anchor={anchorEl} onDismiss={() => undefined} className="wb-note-pop wb-note-conflict">
          <span className="cell-note cell-note-conflict">
            <span data-testid={`cell-conflict-${rowId}-${field.field_id}`}>{active.message}</span>
            <button
              type="button"
              className="wb-note-btn"
              data-testid={`cell-reread-${rowId}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ctx.reread(rowId)}
            >
              重新读取该行
            </button>
          </span>
        </Popover>
      )}
    </div>
  );
}

/** 列头：类型图标 + 字段名（双击行内改名，真保存）。 */
function ColumnHeader(
  props: IHeaderParams & { fieldType: string; fieldId?: string; onRename?: (fieldId: string, name: string) => void }
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.displayName);
  const canRename = Boolean(props.fieldId && props.onRename);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== props.displayName && props.fieldId) props.onRename!(props.fieldId, next);
    else setDraft(props.displayName);
  };

  if (editing) {
    return (
      <input
        className="wb-colhead-input"
        data-testid={props.fieldId ? `colhead-input-${props.fieldId}` : undefined}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(props.displayName);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span
      className="wb-colhead"
      title={`${props.displayName} · ${fieldTypeLabel(props.fieldType)}${canRename ? ' · 双击改名' : ''}`}
      onDoubleClick={() => {
        if (!canRename) return;
        setDraft(props.displayName);
        setEditing(true);
      }}
    >
      <span className="wb-colhead-ico">
        <FieldIcon type={props.fieldType} />
      </span>
      <span className="wb-colhead-name">{props.displayName}</span>
    </span>
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
  /** rollup/lookup 字段读时聚合值（页面预取 /rollups 后下发：field_id→row_id→聚合值） */
  rollupMeta?: RollupMeta;
  /** 空表引导的「新建第一行」入口（回落到工具栏新增行） */
  onAddRow?: () => void;
  /** 列头双击改字段名（行内改名，真保存） */
  onRenameField?: (fieldId: string, name: string) => void;
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
  rollupMeta = {},
  onAddRow,
  onRenameField,
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
      rollupMeta,
    }),
    [active, beginEdit, setDraft, commit, reread, onExpand, onDelete, relationMeta, onRelationEdit, onRelationJump, rollupMeta]
  );

  const columnDefs = useMemo<ColDef<WorkbenchRow>[]>(() => {
    const expandCol: ColDef<WorkbenchRow> = {
      colId: '__expand',
      headerName: '',
      width: 76,
      pinned: 'left',
      sortable: false,
      resizable: false,
      cellClass: 'wb-ops-cell',
      cellRenderer: (p: ICellRendererParams<WorkbenchRow>) => <RowOpsCell rowId={p.data?.row_id ?? ''} />,
    };
    return [
      expandCol,
      ...fields.map<ColDef<WorkbenchRow>>((f) => ({
        colId: f.field_id ?? f.name,
        headerName: f.name,
        minWidth: 168,
        flex: 1,
        sortable: false,
        headerComponent: ColumnHeader,
        headerComponentParams: { fieldType: f.field_type, fieldId: f.field_id, onRename: onRenameField },
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
  }, [fields, onRenameField]);

  const empty = rows.length === 0;

  return (
    <CellContext.Provider value={ctxValue}>
      {/* 单元格宽度有限，失败原因在格子里会被裁掉半句。原因是"用户必须看得懂发生了什么"的
          载体，不能只存在于一个被裁剪的角落，所以同一条消息在表格上方整句再出一次。 */}
      {active && (active.status === 'error' || active.status === 'conflict') && (
        <div className={`grid-banner grid-banner-${active.status}`} data-testid="cell-status-banner">
          {active.message}
        </div>
      )}
      <div className="wb-grid-frame">
        <div
          data-testid="row-grid"
          className="ag-theme-quartz workbench-grid"
          style={{ width: '100%', height: empty ? 44 : 480 }}
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
            rowHeight={46}
            headerHeight={42}
            overlayNoRowsTemplate="<span></span>"
            // 全量渲染：列虚拟化会让右侧几列不进 DOM，"每一格都能被点到"就不成立了
            suppressColumnVirtualisation
            suppressCellFocus
            animateRows={false}
          />
        </div>
        {empty && (
          <div className="wb-empty" data-testid="row-grid-empty">
            <div className="wb-empty-art" aria-hidden>
              <svg width="72" height="56" viewBox="0 0 72 56" fill="none">
                <rect x="4" y="6" width="64" height="44" rx="6" stroke="currentColor" strokeWidth="2" />
                <path d="M4 20h64M26 20v30M4 35h64" stroke="currentColor" strokeWidth="1.6" />
                <rect x="9" y="10" width="12" height="6" rx="2" fill="currentColor" opacity="0.35" />
              </svg>
            </div>
            <p className="wb-empty-title">这张表还是空的</p>
            <p className="wb-empty-sub">录入第一行，或直接把一片表格粘贴进来。</p>
            {onAddRow && (
              <button type="button" className="wb-btn wb-btn-primary wb-empty-cta" onClick={onAddRow}>
                + 新建第一行
              </button>
            )}
          </div>
        )}
      </div>
    </CellContext.Provider>
  );
}

function RowOpsCell({ rowId }: { rowId: string }) {
  const ctx = useContext(CellContext)!;
  return (
    <span className="row-ops wb-row-ops">
      <button
        type="button"
        className="wb-icon-btn"
        title="展开该行"
        aria-label="展开"
        data-testid={`row-expand-${rowId}`}
        onClick={() => ctx.expand(rowId)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" />
        </svg>
      </button>
      <button
        type="button"
        className="wb-icon-btn wb-icon-danger"
        title="删除该行"
        aria-label="删除"
        data-testid={`row-delete-${rowId}`}
        onClick={() => ctx.remove(rowId)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M10 11v6M14 11v6" />
        </svg>
      </button>
    </span>
  );
}
