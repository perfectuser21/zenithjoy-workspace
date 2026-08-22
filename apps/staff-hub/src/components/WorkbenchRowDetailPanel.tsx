/**
 * 行详情面板 —— 一行的字段全集，长文本给真正的多行编辑区（路③ Sprint B / S2）
 *
 * 为什么要有它：表格视图一格只有一行高，长文本在里面既看不全也改不动。
 * 面板里的改动同样**失焦即存**，且与表格视图共用一条写回语义：
 * 成功以服务端返回的整行 + 新 version 回填；撞上 404（该行已被他人删除）交给页面出可见提示，
 * 绝不白屏、也不静默把面板关掉——那样用户会以为自己刚才什么都没做。
 */
import { useEffect, useState } from 'react';
import {
  getBackrefs,
  parseCellInput,
  patchRow,
  WorkbenchRequestError,
  type Backref,
  type CellValue,
  type WorkbenchField,
  type WorkbenchRow,
} from '../lib/workbenchFetch';
import type { RelationMeta } from './WorkbenchRowGrid';

export interface WorkbenchRowDetailPanelProps {
  row: WorkbenchRow;
  fields: WorkbenchField[];
  onRowSaved: (row: WorkbenchRow) => void;
  onRowGone: (rowId: string) => void;
  onClose: () => void;
  /** relation 字段渲染元数据（目标表 id + row_id→标题；缺项即失效） */
  relationMeta?: Record<string, RelationMeta>;
  /** 反向面板 / 关联项里点某条 → 跳到目标记录（可选：只读展示不给跳转也成立） */
  onRelationJump?: (targetTableId: string, targetRowId: string) => void;
}

function textOf(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('、');
  return String(value);
}

export default function WorkbenchRowDetailPanel({
  row,
  fields,
  onRowSaved,
  onRowGone,
  onClose,
  relationMeta = {},
  onRelationJump,
}: WorkbenchRowDetailPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string | string[]>>({});
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [backrefs, setBackrefs] = useState<Backref[]>([]);
  const [backrefLoaded, setBackrefLoaded] = useState(false);

  // 反向引用「谁引用了我」：随面板打开拉一次；A29② 他人私有来源已在服务端剔除。
  useEffect(() => {
    let alive = true;
    setBackrefLoaded(false);
    getBackrefs(row.row_id)
      .then((out) => {
        if (alive) {
          setBackrefs(out.backrefs);
          setBackrefLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setBackrefLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [row.row_id]);

  const valueOf = (fieldId: string): string | string[] =>
    drafts[fieldId] ?? textOf(row.data[fieldId] ?? null);

  const save = async (field: WorkbenchField) => {
    const fieldId = field.field_id ?? '';
    const draft = drafts[fieldId];
    if (draft === undefined) return;
    setError('');
    try {
      const saved = await patchRow(row.row_id, row.version, {
        [fieldId]: parseCellInput(field.field_type, draft),
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
      setHint(`已保存 ${new Date(saved.updated_at).toLocaleTimeString()}`);
      onRowSaved(saved);
    } catch (e) {
      const err = e instanceof WorkbenchRequestError ? e : null;
      if (err?.status === 404) {
        onRowGone(row.row_id);
        return;
      }
      setHint('');
      setError(err ? err.message : '写回失败，改动未保存（内容仍在编辑区里）');
    }
  };

  return (
    <aside data-testid="row-detail-panel" className="row-detail-panel">
      <header>
        <h3>行详情</h3>
        <button type="button" data-testid="detail-close-button" onClick={onClose}>
          收起
        </button>
      </header>
      {hint && (
        <p className="detail-hint" data-testid="detail-save-hint">
          {hint}
        </p>
      )}
      {error && (
        <p className="detail-error" data-testid="detail-error">
          {error}
        </p>
      )}
      <dl>
        {fields.map((f) => {
          const fieldId = f.field_id ?? '';
          const testId = `detail-field-${fieldId}`;
          const draft = valueOf(fieldId);
          const onChange = (v: string | string[]) => setDrafts((prev) => ({ ...prev, [fieldId]: v }));
          return (
            <div key={fieldId} className="detail-row">
              <dt data-testid={`detail-label-${fieldId}`}>{f.name}</dt>
              <dd>
                {f.field_type === 'relation' ? (
                  <RelationFieldView
                    rowId={row.row_id}
                    fieldId={fieldId}
                    value={row.data[fieldId] ?? null}
                    meta={relationMeta[fieldId]}
                    onJump={onRelationJump}
                  />
                ) : f.field_type === 'long_text' ? (
                  <textarea
                    data-testid={testId}
                    rows={5}
                    value={Array.isArray(draft) ? draft.join('') : draft}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(f)}
                  />
                ) : f.field_type === 'single_select' ? (
                  <select
                    data-testid={testId}
                    value={Array.isArray(draft) ? draft[0] ?? '' : draft}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(f)}
                  >
                    <option value="">（清空）</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : f.field_type === 'multi_select' ? (
                  <select
                    data-testid={testId}
                    multiple
                    value={Array.isArray(draft) ? draft : draft ? draft.split('、') : []}
                    onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
                    onBlur={() => void save(f)}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    data-testid={testId}
                    type={f.field_type === 'date' ? 'date' : 'text'}
                    value={Array.isArray(draft) ? draft.join('') : draft}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(f)}
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <section className="backref-panel" data-testid="backref-panel">
        <h4>谁引用了我</h4>
        {!backrefLoaded ? (
          <p className="backref-loading">加载中…</p>
        ) : backrefs.length === 0 ? (
          <p className="backref-empty" data-testid="backref-empty">
            暂无其他记录引用它
          </p>
        ) : (
          <ul data-testid="backref-list">
            {backrefs.map((b) => (
              <li key={`${b.table_id}-${b.row_id}-${b.field_id}`} data-testid={`backref-${b.row_id}`}>
                <button
                  type="button"
                  className="backref-item"
                  data-testid={`backref-jump-${b.row_id}`}
                  title="跳转到引用来源记录"
                  onClick={() => onRelationJump?.(b.table_id, b.row_id)}
                >
                  {b.table_name} · {b.row_title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

/** 详情面板里的 relation 字段：只读展示关联记录标题 chip；已删目标示失效标记、不给可跳转入口。 */
function RelationFieldView({
  rowId,
  fieldId,
  value,
  meta,
  onJump,
}: {
  rowId: string;
  fieldId: string;
  value: CellValue;
  meta: RelationMeta | undefined;
  onJump?: (targetTableId: string, targetRowId: string) => void;
}) {
  const ids = Array.isArray(value) ? value.map((v) => String(v)) : [];
  if (ids.length === 0) return <span className="rel-empty">—</span>;
  return (
    <div className="detail-relation" data-testid={`detail-relation-${fieldId}`}>
      {ids.map((id) => {
        const title = meta?.titleByRow[id];
        const isStale = meta !== undefined && title === undefined;
        if (isStale) {
          return (
            <span
              key={id}
              className="rel-chip rel-chip-stale"
              data-testid={`detail-rel-chip-stale-${rowId}-${fieldId}-${id}`}
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
            data-testid={`detail-rel-chip-${rowId}-${fieldId}-${id}`}
            title="点击跳转到关联记录"
            onClick={() => meta && onJump?.(meta.targetTableId, id)}
          >
            {title ?? id}
          </button>
        );
      })}
    </div>
  );
}
