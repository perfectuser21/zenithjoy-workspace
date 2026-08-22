/**
 * 表格视图页 —— 员工把数据录进自己组织的一张表，并按视图筛/排/切看板（路③ S2 + S3）
 *
 * Sprint C 新增（S3「视图切得开」）：
 *   - 视图列表 + 表格/看板切换 + 分组列 + 筛/排 + 隐藏列，配置持久化到 db_view_prefs（存 field_id）
 *   - 看板：单选字段分组 + 未分组列，指针拖卡改值走 PATCH /rows/:id（乐观锁），失败弹回原列 + 可见提示
 *   - 视图偏好保存失败 → 工具条可见提示「视图偏好未保存」，页面主体不白屏、可重试（禁静默吞）
 *
 * 上限不写死在前端：row_limit 由服务端随行列表下发。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import WorkbenchRowGrid, { type RelationMeta } from '../components/WorkbenchRowGrid';
import WorkbenchRowDetailPanel from '../components/WorkbenchRowDetailPanel';
import WorkbenchViewSwitcher from '../components/WorkbenchViewSwitcher';
import WorkbenchKanbanView from '../components/WorkbenchKanbanView';
import type { DropPatch } from '../lib/workbenchKanban';
import {
  createRow,
  createView,
  deleteRow,
  deleteView,
  exportTable,
  getTable,
  listRelationCandidates,
  listRowTrash,
  listRows,
  listRowsWith,
  listViews,
  patchRow,
  patchView,
  pasteRows,
  restoreRow,
  RELATION_FIELD_TYPE,
  type RelationCandidate,
  WorkbenchRequestError,
  type CellValue,
  type RowTrashEntry,
  type ViewFilter,
  type ViewSort,
  type WorkbenchField,
  type WorkbenchRow,
  type WorkbenchView,
} from '../lib/workbenchFetch';

interface RelationPickerState {
  rowId: string;
  version: number;
  field: WorkbenchField;
  targetTableId: string;
  candidates: RelationCandidate[];
  selected: string[];
}

/** 剪贴板里的一片表格就是 TSV：首行列名，其余是数据行 */
export function parseClipboardTable(text: string): { header: string[]; rows: string[][] } | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) return null;
  return { header: lines[0].split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) };
}

export default function WorkbenchTablePage() {
  const { tableId = '' } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tableName, setTableName] = useState('');
  const [fields, setFields] = useState<WorkbenchField[]>([]);
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [rowLimit, setRowLimit] = useState<number | null>(null);
  const [trash, setTrash] = useState<RowTrashEntry[]>([]);
  const [detailRow, setDetailRow] = useState<WorkbenchRow | null>(null);
  const [rowGone, setRowGone] = useState('');
  // ── 关联状态（S4）──────────────────────────────────────────────────────────
  const [relationMeta, setRelationMeta] = useState<Record<string, RelationMeta>>({});
  const [relationPicker, setRelationPicker] = useState<RelationPickerState | null>(null);
  const [relationError, setRelationError] = useState('');
  const [pasteNotice, setPasteNotice] = useState('');
  const [exported, setExported] = useState<{ rows: number; href: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // ── 视图状态（S3）──────────────────────────────────────────────────────────
  const [views, setViews] = useState<WorkbenchView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [filterFieldId, setFilterFieldId] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sortFieldId, setSortFieldId] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [viewPrefsError, setViewPrefsError] = useState('');
  const [kanbanError, setKanbanError] = useState('');
  const [kanbanConflict, setKanbanConflict] = useState('');

  const currentView = useMemo(
    () => views.find((v) => v.view_id === activeViewId) ?? null,
    [views, activeViewId]
  );

  const fetchRows = useCallback(async () => {
    const out = await listRows(tableId);
    setRows(out.rows);
    setRowLimit(out.row_limit);
    return out.rows;
  }, [tableId]);

  const fetchTrash = useCallback(async () => {
    setTrash(await listRowTrash(tableId));
  }, [tableId]);

  /** relation 字段的渲染元数据：为每个 relation 字段预取候选，建 row_id→标题 映射 + 目标表 id。 */
  const refreshRelationMeta = useCallback(
    async (flds: WorkbenchField[]) => {
      const relFields = flds.filter((f) => f.field_type === RELATION_FIELD_TYPE && f.field_id);
      if (relFields.length === 0) {
        setRelationMeta({});
        return;
      }
      const meta: Record<string, RelationMeta> = {};
      for (const f of relFields) {
        try {
          const out = await listRelationCandidates(tableId, f.field_id!);
          const titleByRow: Record<string, string> = {};
          for (const c of out.candidates) titleByRow[c.row_id] = c.title;
          meta[f.field_id!] = { targetTableId: out.target_table_id, titleByRow };
        } catch {
          // 单个字段候选拉取失败不拖垮整页：该字段的 chip 回落显示 row_id
        }
      }
      setRelationMeta(meta);
    },
    [tableId]
  );

  const refreshViews = useCallback(async (): Promise<WorkbenchView[]> => {
    const out = await listViews(tableId);
    let list = out.views;
    let active = out.active_view_id;
    // 首次进表没有任何视图 → 建一个默认表格视图（前端建默认视图，S1）
    if (list.length === 0) {
      const created = await createView(tableId, {
        name: '默认视图',
        view_type: 'grid',
        is_active: true,
      });
      list = [created];
      active = created.view_id;
    }
    setViews(list);
    setActiveViewId((prev) => (prev && list.some((v) => v.view_id === prev) ? prev : active ?? list[0].view_id));
    return list;
  }, [tableId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getTable(tableId);
      setTableName(detail.name);
      setFields(detail.fields);
      await refreshViews();
      await fetchRows();
      await fetchTrash();
      await refreshRelationMeta(detail.fields);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tableId, refreshViews, fetchRows, fetchTrash, refreshRelationMeta]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // 跨表跳转落地：?open=<rowId> → 打开该行详情面板（打开后清掉参数，避免关闭后又被拉回）
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || rows.length === 0) return;
    const hit = rows.find((r) => r.row_id === openId);
    if (hit) {
      setDetailRow(hit);
      setRowGone('');
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, rows, setSearchParams]);

  // 切换当前视图时，把筛/排控件初值同步成该视图存的值
  useEffect(() => {
    if (!currentView) return;
    setFilterFieldId(currentView.filters[0]?.field_id ?? '');
    setFilterValue(currentView.filters[0]?.value != null ? String(currentView.filters[0].value) : '');
    setSortFieldId(currentView.sorts[0]?.field_id ?? '');
    setSortDir(currentView.sorts[0]?.dir ?? 'asc');
  }, [currentView]);

  /** 写回成功：拿服务端返回的整行就地回填（含新 version），不整表重拉 */
  const applySavedRow = useCallback((saved: WorkbenchRow) => {
    setRows((prev) => prev.map((r) => (r.row_id === saved.row_id ? saved : r)));
    setDetailRow((prev) => (prev && prev.row_id === saved.row_id ? saved : prev));
    setRowGone('');
  }, []);

  const noteRowGone = useCallback((rowId: string) => {
    setRowGone(rowId);
    setRows((prev) => prev.filter((r) => r.row_id !== rowId));
  }, []);

  // ── 关联：行选择器（配置关联）+ 点关联项跳转（S4）───────────────────────────
  const openRelationPicker = useCallback(
    async (rowId: string, field: WorkbenchField) => {
      const row = rows.find((r) => r.row_id === rowId);
      if (!row || !field.field_id) return;
      setRelationError('');
      try {
        const out = await listRelationCandidates(tableId, field.field_id);
        const current = Array.isArray(row.data[field.field_id])
          ? (row.data[field.field_id] as string[]).map((v) => String(v))
          : [];
        setRelationPicker({
          rowId,
          version: row.version,
          field,
          targetTableId: out.target_table_id,
          candidates: out.candidates,
          selected: current,
        });
      } catch (e) {
        setRelationError(e instanceof Error ? e.message : '拉取候选记录失败');
      }
    },
    [rows, tableId]
  );

  const toggleRelationSelect = useCallback((id: string) => {
    setRelationPicker((prev) =>
      prev
        ? {
            ...prev,
            selected: prev.selected.includes(id)
              ? prev.selected.filter((x) => x !== id)
              : [...prev.selected, id],
          }
        : prev
    );
  }, []);

  const saveRelationPicker = useCallback(async () => {
    if (!relationPicker) return;
    const { rowId, version, field, selected } = relationPicker;
    setRelationError('');
    try {
      const saved = await patchRow(rowId, version, { [field.field_id!]: selected });
      applySavedRow(saved);
      setRelationPicker(null);
      await refreshRelationMeta(fields);
    } catch (e) {
      const err = e instanceof WorkbenchRequestError ? e : null;
      setRelationError(err ? err.message : '关联保存失败，请重试');
    }
  }, [relationPicker, applySavedRow, refreshRelationMeta, fields]);

  /** 点关联项 → 跳转到目标表该记录：同表就地开详情，跨表带 ?open= 导航过去。 */
  const relationJump = useCallback(
    (targetTableId: string, targetRowId: string) => {
      if (targetTableId === tableId) {
        const hit = rows.find((r) => r.row_id === targetRowId);
        if (hit) {
          setRowGone('');
          setDetailRow(hit);
        }
        return;
      }
      navigate(`/workbench/tables/${targetTableId}?open=${targetRowId}`);
    },
    [tableId, rows, navigate]
  );

  const rereadRow = useCallback(
    async (rowId: string) => {
      try {
        const fresh = await listRows(tableId);
        const hit = fresh.rows.find((r) => r.row_id === rowId);
        if (hit) applySavedRow(hit);
        else noteRowGone(rowId);
      } catch (e) {
        setError(e instanceof Error ? e.message : '重新读取该行失败');
      }
    },
    [tableId, applySavedRow, noteRowGone]
  );

  const addRow = useCallback(async () => {
    try {
      const row = await createRow(tableId);
      setRows((prev) => [...prev, row]);
      setPasteNotice('');
    } catch (e) {
      const err = e instanceof WorkbenchRequestError ? e : null;
      setError(err ? err.message : '新增行失败');
    }
  }, [tableId]);

  const removeRow = useCallback(
    async (rowId: string) => {
      try {
        await deleteRow(rowId);
        setRows((prev) => prev.filter((r) => r.row_id !== rowId));
        if (detailRow?.row_id === rowId) setDetailRow(null);
        await fetchTrash();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删行失败');
      }
    },
    [detailRow, fetchTrash]
  );

  const restoreFromTrash = useCallback(
    async (rowId: string) => {
      try {
        await restoreRow(rowId);
        await fetchRows();
        await fetchTrash();
      } catch (e) {
        setError(e instanceof Error ? e.message : '还原失败');
      }
    },
    [fetchRows, fetchTrash]
  );

  const handlePasteText = useCallback(
    async (text: string) => {
      const parsed = parseClipboardTable(text);
      if (!parsed) {
        setPasteNotice('粘贴内容不是一片表格（至少要有列名行 + 一行数据）');
        return;
      }
      try {
        const out = await pasteRows(tableId, parsed.header, parsed.rows);
        setPasteNotice(
          `已导入 ${out.inserted} 行` +
            (out.created_fields.length > 0 ? `，自动新建 ${out.created_fields.length} 个文本字段` : '')
        );
        const detail = await getTable(tableId);
        setFields(detail.fields);
        await fetchRows();
      } catch (e) {
        const err = e instanceof WorkbenchRequestError ? e : null;
        setPasteNotice(err ? err.message : '粘贴导入失败');
      }
    },
    [tableId, fetchRows]
  );

  const doExport = useCallback(async () => {
    try {
      const out = await exportTable(tableId);
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      setExported({ rows: out.rows.length, href: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    }
  }, [tableId]);

  // ── 视图偏好持久化（S3 / A21 / A23）─────────────────────────────────────────
  // 保存失败 → 可见提示「视图偏好未保存」，页面主体不白屏、本地状态保留可重试（禁静默吞）。
  const saveView = useCallback(
    async (patch: Parameters<typeof patchView>[1]) => {
      if (!activeViewId) return;
      // 本地先乐观回填，保证保存失败时用户改的东西还在
      setViews((prev) => prev.map((v) => (v.view_id === activeViewId ? { ...v, ...patch } : v)));
      try {
        const updated = await patchView(activeViewId, patch);
        setViews((prev) => prev.map((v) => (v.view_id === activeViewId ? updated : v)));
        setViewPrefsError('');
      } catch (e) {
        const err = e instanceof WorkbenchRequestError ? e : null;
        setViewPrefsError(`视图偏好未保存${err ? `（${err.message}）` : ''}，请重试`);
      }
    },
    [activeViewId]
  );

  const retrySaveView = useCallback(() => {
    if (!currentView) return;
    void saveView({
      view_type: currentView.view_type,
      group_field_id: currentView.group_field_id,
      filters: currentView.filters,
      sorts: currentView.sorts,
      hidden_field_ids: currentView.hidden_field_ids,
    });
  }, [currentView, saveView]);

  const applyQuery = useCallback(async () => {
    const filters: ViewFilter[] = filterFieldId
      ? [{ field_id: filterFieldId, op: 'contains', value: filterValue }]
      : [];
    const sorts: ViewSort[] = sortFieldId ? [{ field_id: sortFieldId, dir: sortDir }] : [];
    try {
      const out = await listRowsWith(tableId, { filter: filters, sort: sorts });
      setRows(out.rows);
      setRowLimit(out.row_limit);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '筛选排序失败');
    }
    await saveView({ filters, sorts });
  }, [tableId, filterFieldId, filterValue, sortFieldId, sortDir, saveView]);

  const activateView = useCallback(
    async (viewId: string) => {
      setActiveViewId(viewId);
      try {
        await patchView(viewId, { is_active: true });
        await refreshViews();
        await fetchRows();
      } catch (e) {
        setError(e instanceof Error ? e.message : '切换视图失败');
      }
    },
    [refreshViews, fetchRows]
  );

  const handleCreateView = useCallback(async () => {
    try {
      const created = await createView(tableId, {
        name: `视图 ${views.length + 1}`,
        view_type: 'grid',
        is_active: true,
      });
      setActiveViewId(created.view_id);
      await refreshViews();
    } catch (e) {
      setError(e instanceof Error ? e.message : '新建视图失败');
    }
  }, [tableId, views.length, refreshViews]);

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      try {
        await deleteView(viewId);
        setActiveViewId(null);
        await refreshViews();
        setViewPrefsError('');
      } catch (e) {
        const err = e instanceof WorkbenchRequestError ? e : null;
        setViewPrefsError(err ? err.message : '删除视图失败');
      }
    },
    [refreshViews]
  );

  const toggleHidden = useCallback(
    (fieldId: string) => {
      if (!currentView) return;
      const hidden = currentView.hidden_field_ids.includes(fieldId)
        ? currentView.hidden_field_ids.filter((x) => x !== fieldId)
        : [...currentView.hidden_field_ids, fieldId];
      void saveView({ hidden_field_ids: hidden });
    },
    [currentView, saveView]
  );

  /** 拖卡换列：走 PATCH /rows/:id 乐观锁。409 → 弹回原列 + 冲突提示；断网/5xx → 弹回原列 + 错误提示。 */
  const onCardMoved = useCallback(
    async (patch: DropPatch) => {
      setKanbanError('');
      setKanbanConflict('');
      try {
        const saved = await patchRow(patch.row_id, patch.version, patch.data as Record<string, CellValue>);
        applySavedRow(saved);
      } catch (e) {
        // rows 状态未动，卡片自然留在原列（弹回）；只把可见提示打出来
        if (e instanceof WorkbenchRequestError && e.status === 409) {
          setKanbanConflict('该行已被他人修改，你的改动未保存');
        } else {
          setKanbanError('拖动未保存，请重试');
        }
      }
    },
    [applySavedRow]
  );

  const atLimit = rowLimit !== null && rows.length >= rowLimit;
  const hidden = currentView?.hidden_field_ids ?? [];
  const visibleFields = fields.filter((f) => !hidden.includes(f.field_id ?? ''));
  const isKanban = currentView?.view_type === 'kanban';

  return (
    <div className="page" data-testid="workbench-table-page">
      <p>
        <Link to="/workbench">← 回到工作台</Link>
      </p>
      <h1>{tableName || '表格视图'}</h1>

      {error && (
        <div className="error-banner" data-testid="table-page-error">
          {error}
        </div>
      )}

      {!loading && (
        <WorkbenchViewSwitcher
          views={views}
          activeViewId={activeViewId}
          view={currentView}
          fields={fields}
          filterFieldId={filterFieldId}
          filterValue={filterValue}
          sortFieldId={sortFieldId}
          sortDir={sortDir}
          onActivate={(id) => void activateView(id)}
          onCreateView={() => void handleCreateView()}
          onDeleteView={(id) => void handleDeleteView(id)}
          onViewTypeChange={(t) => void saveView({ view_type: t })}
          onGroupFieldChange={(fid) => void saveView({ group_field_id: fid || null })}
          onToggleHidden={toggleHidden}
          onFilterFieldChange={setFilterFieldId}
          onFilterValueChange={setFilterValue}
          onSortFieldChange={setSortFieldId}
          onSortDirChange={setSortDir}
          onApplyQuery={() => void applyQuery()}
        />
      )}

      {viewPrefsError && (
        <div className="view-prefs-error" data-testid="view-prefs-error">
          {viewPrefsError}
          <button type="button" data-testid="view-prefs-retry" onClick={retrySaveView}>
            重试
          </button>
        </div>
      )}

      <div className="row-toolbar">
        <button type="button" data-testid="add-row-button" disabled={atLimit} onClick={() => void addRow()}>
          新增行
        </button>
        <span data-testid="row-limit-hint">
          已有 {rows.length} 行 / 上限 {rowLimit ?? '…'} 行
        </span>
        <button type="button" data-testid="export-json-button" onClick={() => void doExport()}>
          导出 JSON
        </button>
        {exported && (
          <span data-testid="export-summary">
            已导出 {exported.rows} 行 ·{' '}
            <a href={exported.href} download={`${tableName || 'table'}.json`}>
              下载
            </a>
          </span>
        )}
      </div>

      {pasteNotice && (
        <div className="paste-notice" data-testid="paste-notice">
          {pasteNotice}
        </div>
      )}

      {isKanban && (
        <div className="kanban-notices">
          {kanbanError && (
            <div className="kanban-drop-error" data-testid="kanban-drop-error">
              {kanbanError}
            </div>
          )}
          {kanbanConflict && (
            <div className="kanban-drop-conflict" data-testid="kanban-drop-conflict">
              {kanbanConflict}
            </div>
          )}
        </div>
      )}

      <div className="table-layout">
        <div className="table-main">
          {loading ? (
            <p>加载中…</p>
          ) : isKanban ? (
            <WorkbenchKanbanView
              fields={fields}
              rows={rows}
              groupFieldId={currentView?.group_field_id ?? null}
              onCardMoved={(patch) => void onCardMoved(patch)}
            />
          ) : (
            <WorkbenchRowGrid
              fields={visibleFields}
              rows={rows}
              onRowSaved={applySavedRow}
              onRowGone={noteRowGone}
              onReread={(id) => void rereadRow(id)}
              onExpand={(id) => {
                setRowGone('');
                setDetailRow(rows.find((r) => r.row_id === id) ?? null);
              }}
              onDelete={(id) => void removeRow(id)}
              onPasteText={(text) => void handlePasteText(text)}
              relationMeta={relationMeta}
              onRelationEdit={(id, field) => void openRelationPicker(id, field)}
              onRelationJump={relationJump}
            />
          )}
        </div>

        <div className="table-side">
          {rowGone && (
            <div className="row-gone" data-testid="row-gone-notice">
              该行已被删除，你的改动未保存
            </div>
          )}
          {detailRow && (
            <WorkbenchRowDetailPanel
              row={detailRow}
              fields={fields}
              onRowSaved={applySavedRow}
              onRowGone={noteRowGone}
              onClose={() => setDetailRow(null)}
              onRelationJump={relationJump}
            />
          )}
        </div>
      </div>

      {relationPicker && (
        <div className="relation-picker-modal" data-testid="relation-picker">
          <div className="relation-picker-box">
            <header>
              <h3>配置关联 · {relationPicker.field.name}</h3>
              <button
                type="button"
                data-testid="relation-picker-close"
                onClick={() => setRelationPicker(null)}
              >
                取消
              </button>
            </header>
            {relationError && (
              <p className="relation-error" data-testid="relation-picker-error">
                {relationError}
              </p>
            )}
            <ul data-testid="relation-candidate-list">
              {relationPicker.candidates.map((c) => (
                <li key={c.row_id}>
                  <label data-testid={`relation-pick-${c.row_id}`}>
                    <input
                      type="checkbox"
                      checked={relationPicker.selected.includes(c.row_id)}
                      onChange={() => toggleRelationSelect(c.row_id)}
                    />
                    {c.title}
                  </label>
                </li>
              ))}
              {relationPicker.candidates.length === 0 && (
                <li data-testid="relation-candidate-empty">目标表暂无可关联记录</li>
              )}
            </ul>
            <button type="button" data-testid="relation-picker-save" onClick={() => void saveRelationPicker()}>
              保存关联
            </button>
          </div>
        </div>
      )}

      <section>
        <h2>行回收站</h2>
        <ul data-testid="row-trash-list">
          {trash.map((t) => (
            <li key={t.row_id} data-testid={`row-trash-${t.row_id}`}>
              行 {t.row_id.slice(0, 8)}（可还原至 {t.restorable_until.slice(0, 10)}）
              <button
                type="button"
                data-testid={`row-restore-${t.row_id}`}
                onClick={() => void restoreFromTrash(t.row_id)}
              >
                还原
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
