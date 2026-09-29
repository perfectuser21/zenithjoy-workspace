/**
 * 行详情面板 —— 一行的字段全集，长文本给真正的多行编辑区（路③ Sprint B / S2）
 *
 * 为什么要有它：表格视图一格只有一行高，长文本在里面既看不全也改不动。
 * 面板里的改动同样**失焦即存**，且与表格视图共用一条写回语义：
 * 成功以服务端返回的整行 + 新 version 回填；撞上 404（该行已被他人删除）交给页面出可见提示，
 * 绝不白屏、也不静默把面板关掉——那样用户会以为自己刚才什么都没做。
 *
 * UI 呈现层（Notion 级重做）：每个字段一行"图标 + 字段名 + 编辑器"，长文本给大编辑区，
 * 关联/反向引用做成可点 chip —— 写回语义一字不改。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { FieldIcon, fieldTypeLabel, tagColor } from '../lib/workbenchFieldMeta';
import type { RelationMeta } from './WorkbenchRowGrid';

/** 详情面板里的彩色标签编辑器（单选/多选共用）——点开一个精致浮层，和表格里的观感一致。 */
function DetailTagField({
  testId,
  multi,
  options,
  selected,
  onSave,
}: {
  testId: string;
  multi: boolean;
  options: string[];
  selected: string[];
  onSave: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  // 始终指向最新 draft，供外部点击的关闭回调读取（闭包快照会拿到陈旧值）
  const draftRef = useRef<string[]>(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    setDraft(selected);
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
      if (multi) onSaveRef.current(draftRef.current);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, multi]);

  const pick = (opt: string) => {
    if (multi) {
      setDraft((d) => (d.includes(opt) ? d.filter((x) => x !== opt) : [...d, opt]));
    } else {
      onSave(opt ? [opt] : []);
      setOpen(false);
    }
  };

  return (
    <div className="wb-detail-tagfield" data-testid={testId}>
      <button ref={anchorRef} type="button" className="wb-detail-tagbtn" onClick={() => setOpen((v) => !v)}>
        {selected.length > 0 ? (
          selected.map((v) => {
            const c = tagColor(v);
            return (
              <span key={v} className="wb-tag" style={{ background: c.bg, color: c.fg }}>
                <span className="wb-tag-dot" style={{ background: c.dot }} />
                {v}
              </span>
            );
          })
        ) : (
          <span className="wb-cell-empty">选择…</span>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="wb-popover wb-select-pop" style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
            <div className="wb-select-scroll">
              {!multi && (
                <button type="button" className="wb-select-opt" onClick={() => pick('')}>
                  <span className="wb-select-clear">清空</span>
                </button>
              )}
              {options.map((o) => {
                const on = draft.includes(o);
                const c = tagColor(o);
                return (
                  <button type="button" key={o} className={`wb-select-opt${on ? ' on' : ''}`} onClick={() => pick(o)}>
                    <span className="wb-tag" style={{ background: c.bg, color: c.fg }}>
                      <span className="wb-tag-dot" style={{ background: c.dot }} />
                      {o}
                    </span>
                    {on && <span className="wb-select-check">✓</span>}
                  </button>
                );
              })}
              {options.length === 0 && <div className="wb-select-none">该字段还没有选项</div>}
            </div>
            {multi && (
              <button type="button" className="wb-select-done" onClick={() => { setOpen(false); onSave(draft); }}>
                完成
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

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

/** 取一行的显示标题：第一个非空文本字段的值，退化到 row_id 前 8 位。 */
function rowTitle(row: WorkbenchRow, fields: WorkbenchField[]): string {
  for (const f of fields) {
    if (f.field_type === 'text' || f.field_type === 'long_text') {
      const v = row.data[f.field_id ?? ''];
      if (v != null && v !== '') return String(v);
    }
  }
  return `记录 ${row.row_id.slice(0, 8)}`;
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
    <aside data-testid="row-detail-panel" className="row-detail-panel wb-detail">
      <header className="wb-detail-head">
        <div className="wb-detail-title">
          <span className="wb-detail-eyebrow">行详情</span>
          <h3>{rowTitle(row, fields)}</h3>
        </div>
        <button type="button" className="wb-icon-btn" title="收起" aria-label="收起" data-testid="detail-close-button" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      {hint && (
        <p className="detail-hint wb-detail-hint" data-testid="detail-save-hint">
          <span className="wb-dot-ok" /> {hint}
        </p>
      )}
      {error && (
        <p className="detail-error wb-detail-error" data-testid="detail-error">
          {error}
        </p>
      )}
      <dl className="wb-detail-fields">
        {fields.map((f) => {
          const fieldId = f.field_id ?? '';
          const testId = `detail-field-${fieldId}`;
          const draft = valueOf(fieldId);
          const onChange = (v: string | string[]) => setDrafts((prev) => ({ ...prev, [fieldId]: v }));
          return (
            <div key={fieldId} className="detail-row wb-detail-row">
              <dt data-testid={`detail-label-${fieldId}`} className="wb-detail-label" title={fieldTypeLabel(f.field_type)}>
                <FieldIcon type={f.field_type} />
                <span>{f.name}</span>
              </dt>
              <dd className="wb-detail-value">
                {f.field_type === 'relation' ? (
                  <RelationFieldView
                    rowId={row.row_id}
                    fieldId={fieldId}
                    value={row.data[fieldId] ?? null}
                    meta={relationMeta[fieldId]}
                    onJump={onRelationJump}
                  />
                ) : f.field_type === 'rollup' || f.field_type === 'lookup' ? (
                  <span className="wb-detail-readonly">{textOf(row.data[fieldId] ?? null) || '—'}</span>
                ) : f.field_type === 'long_text' ? (
                  <textarea
                    className="wb-input wb-textarea"
                    data-testid={testId}
                    rows={4}
                    value={Array.isArray(draft) ? draft.join('') : draft}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(f)}
                    placeholder="空"
                  />
                ) : f.field_type === 'single_select' || f.field_type === 'multi_select' ? (
                  <DetailTagField
                    testId={testId}
                    multi={f.field_type === 'multi_select'}
                    options={f.options}
                    selected={
                      Array.isArray(draft) ? draft : draft ? (f.field_type === 'multi_select' ? draft.split('、') : [draft]) : []
                    }
                    onSave={(next) => {
                      setDrafts((prev) => ({ ...prev, [fieldId]: f.field_type === 'multi_select' ? next : next[0] ?? '' }));
                      // 直接用 next 写回，绕开 setState 异步（save 读 drafts[fieldId] 可能还没更新）
                      void patchRow(row.row_id, row.version, {
                        [fieldId]: parseCellInput(f.field_type, f.field_type === 'multi_select' ? next : next[0] ?? ''),
                      })
                        .then((saved) => {
                          setDrafts((prev) => {
                            const n = { ...prev };
                            delete n[fieldId];
                            return n;
                          });
                          setHint(`已保存 ${new Date(saved.updated_at).toLocaleTimeString()}`);
                          onRowSaved(saved);
                        })
                        .catch((e) => {
                          const err = e instanceof WorkbenchRequestError ? e : null;
                          if (err?.status === 404) {
                            onRowGone(row.row_id);
                            return;
                          }
                          setHint('');
                          setError(err ? err.message : '写回失败，改动未保存');
                        });
                    }}
                  />
                ) : (
                  <input
                    className="wb-input"
                    data-testid={testId}
                    type={f.field_type === 'date' ? 'date' : 'text'}
                    value={Array.isArray(draft) ? draft.join('') : draft}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(f)}
                    placeholder="空"
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <section className="backref-panel wb-backref" data-testid="backref-panel">
        <h4 className="wb-backref-title">谁引用了我</h4>
        {!backrefLoaded ? (
          <p className="backref-loading wb-muted-sm">加载中…</p>
        ) : backrefs.length === 0 ? (
          <p className="backref-empty wb-muted-sm" data-testid="backref-empty">
            暂无其他记录引用它
          </p>
        ) : (
          <ul className="wb-backref-list" data-testid="backref-list">
            {backrefs.map((b) => (
              <li key={`${b.table_id}-${b.row_id}-${b.field_id}`} data-testid={`backref-${b.row_id}`}>
                <button
                  type="button"
                  className="backref-item wb-backref-item"
                  data-testid={`backref-jump-${b.row_id}`}
                  title="跳转到引用来源记录"
                  onClick={() => onRelationJump?.(b.table_id, b.row_id)}
                >
                  <FieldIcon type="relation" className="wb-inline-ico" />
                  <span className="wb-backref-table">{b.table_name}</span>
                  <span className="wb-backref-sep">·</span>
                  {b.row_title}
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
  if (ids.length === 0) return <span className="rel-empty wb-cell-empty">—</span>;
  return (
    <div className="detail-relation wb-detail-relation" data-testid={`detail-relation-${fieldId}`}>
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
            <FieldIcon type="relation" className="wb-inline-ico" />
            {title ?? id}
          </button>
        );
      })}
    </div>
  );
}
