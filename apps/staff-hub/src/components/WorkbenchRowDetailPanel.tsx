/**
 * 行详情面板 —— 一行的字段全集，长文本给真正的多行编辑区（路③ Sprint B / S2）
 *
 * 为什么要有它：表格视图一格只有一行高，长文本在里面既看不全也改不动。
 * 面板里的改动同样**失焦即存**，且与表格视图共用一条写回语义：
 * 成功以服务端返回的整行 + 新 version 回填；撞上 404（该行已被他人删除）交给页面出可见提示，
 * 绝不白屏、也不静默把面板关掉——那样用户会以为自己刚才什么都没做。
 */
import { useState } from 'react';
import {
  parseCellInput,
  patchRow,
  WorkbenchRequestError,
  type CellValue,
  type WorkbenchField,
  type WorkbenchRow,
} from '../lib/workbenchFetch';

export interface WorkbenchRowDetailPanelProps {
  row: WorkbenchRow;
  fields: WorkbenchField[];
  onRowSaved: (row: WorkbenchRow) => void;
  onRowGone: (rowId: string) => void;
  onClose: () => void;
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
}: WorkbenchRowDetailPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string | string[]>>({});
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');

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
                {f.field_type === 'long_text' ? (
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
    </aside>
  );
}
