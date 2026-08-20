/**
 * 表格视图页 —— 员工把数据录进自己组织的一张表（路③ Sprint B / S2「数据进得来」）
 *
 * Golden Path 六个用户可观察输出，对应 E2E 的六张截图：
 *   01 表格视图打开：列 = 8 类字段，零行，「新增行」可点，可见「已有 N 行 / 上限 M 行」
 *   02 某单元格处于编辑态，编辑器与字段类型匹配
 *   03 同事同时改了同一格 → 冲突提示可见，且自己打的内容仍在编辑器里
 *   04 粘贴超上限 → 提示含当前上限与已有行数，表格行数未变
 *   05 删掉的行从行回收站还原后回到表格，字段值逐字回归
 *   06 行详情面板展开，字段全集可见、长文本是多行编辑区
 *
 * **上限不写死在前端**：`row_limit` 由服务端随行列表下发，UI 硬拦与提示文案都用它。
 * 写死一个数字就等于前端替服务端做了环境假设，服务端一改配置两边当场分叉。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkbenchRowGrid from '../components/WorkbenchRowGrid';
import WorkbenchRowDetailPanel from '../components/WorkbenchRowDetailPanel';
import {
  createRow,
  deleteRow,
  exportTable,
  getTable,
  listRowTrash,
  listRows,
  pasteRows,
  restoreRow,
  WorkbenchRequestError,
  type RowTrashEntry,
  type WorkbenchField,
  type WorkbenchRow,
} from '../lib/workbenchFetch';

/** 剪贴板里的一片表格就是 TSV：首行列名，其余是数据行 */
export function parseClipboardTable(text: string): { header: string[]; rows: string[][] } | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) return null;
  return { header: lines[0].split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) };
}

export default function WorkbenchTablePage() {
  const { tableId = '' } = useParams<{ tableId: string }>();
  const [tableName, setTableName] = useState('');
  const [fields, setFields] = useState<WorkbenchField[]>([]);
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [rowLimit, setRowLimit] = useState<number | null>(null);
  const [trash, setTrash] = useState<RowTrashEntry[]>([]);
  const [detailRow, setDetailRow] = useState<WorkbenchRow | null>(null);
  const [rowGone, setRowGone] = useState('');
  const [pasteNotice, setPasteNotice] = useState('');
  const [exported, setExported] = useState<{ rows: number; href: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    const out = await listRows(tableId);
    setRows(out.rows);
    setRowLimit(out.row_limit);
    return out.rows;
  }, [tableId]);

  const fetchTrash = useCallback(async () => {
    setTrash(await listRowTrash(tableId));
  }, [tableId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getTable(tableId);
      setTableName(detail.name);
      setFields(detail.fields);
      await fetchRows();
      await fetchTrash();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tableId, fetchRows, fetchTrash]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

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

  /** 冲突后由用户显式触发：只把那一行换成服务端的最新值，其余行与编辑态一律不动 */
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
            (out.created_fields.length > 0
              ? `，自动新建 ${out.created_fields.length} 个文本字段`
              : '')
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

  const atLimit = rowLimit !== null && rows.length >= rowLimit;

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

      <div className="table-layout">
        <div className="table-main">
          {loading ? (
            <p>加载中…</p>
          ) : (
            <WorkbenchRowGrid
              fields={fields}
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
            />
          )}
        </div>
      </div>

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
