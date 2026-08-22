/**
 * rollup/lookup 字段配置器（S4 加厚）—— 给某个 relation 字段配一个汇总字段。
 *
 * 员工选「本表哪个关联字段 + 聚合函数 + 目标表哪个字段」→ POST /tables/:id/fields 建 rollup/lookup 字段。
 * 读时计算不落库：配置以位序三元组存 db_fields.options，聚合值由 /rollups 端点读时算。
 * 类型×函数非法（sum 配文本字段等）→ 服务端 400 VALIDATION_FAILED，本组件把文案可见回显（非静默）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createFields,
  getTable,
  RELATION_FIELD_TYPE,
  ROLLUP_FIELD_TYPE,
  LOOKUP_FIELD_TYPE,
  WorkbenchRequestError,
  type WorkbenchField,
} from '../lib/workbenchFetch';

const ROLLUP_FNS = ['count', 'sum', 'min', 'max', 'concat', 'lookup'] as const;

export interface WorkbenchRollupConfigProps {
  tableId: string;
  fields: WorkbenchField[];
  onCreated: () => void;
}

export default function WorkbenchRollupConfig({ tableId, fields, onCreated }: WorkbenchRollupConfigProps) {
  const relationFields = fields.filter((f) => f.field_type === RELATION_FIELD_TYPE && f.field_id);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [relFieldId, setRelFieldId] = useState('');
  const [fn, setFn] = useState<(typeof ROLLUP_FNS)[number]>('count');
  const [targetFieldId, setTargetFieldId] = useState('');
  const [targetFields, setTargetFields] = useState<WorkbenchField[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 选定关联字段 → 拉其目标表字段清单（供目标字段下拉；count 不需要目标字段）
  useEffect(() => {
    const rel = relationFields.find((f) => f.field_id === relFieldId);
    const targetTableId = rel?.options?.[0];
    if (!targetTableId) {
      setTargetFields([]);
      return;
    }
    let cancelled = false;
    void getTable(targetTableId)
      .then((detail) => {
        if (!cancelled) setTargetFields(detail.fields.filter((f) => f.field_id));
      })
      .catch(() => {
        if (!cancelled) setTargetFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [relFieldId, relationFields]);

  const submit = useCallback(async () => {
    setError('');
    if (!relFieldId) {
      setError('请先选一个关联字段');
      return;
    }
    const isLookup = fn === 'lookup';
    const fieldType = isLookup ? LOOKUP_FIELD_TYPE : ROLLUP_FIELD_TYPE;
    // count 不需要目标字段（传空串）；其余取所选目标字段
    const options = isLookup
      ? [relFieldId, targetFieldId]
      : fn === 'count'
        ? [relFieldId, '', fn]
        : [relFieldId, targetFieldId, fn];
    setBusy(true);
    try {
      await createFields(tableId, [
        { field_id: '', name: name || `汇总-${fn}`, field_type: fieldType, options, display_order: 50 },
      ] as WorkbenchField[]);
      setOpen(false);
      setName('');
      setRelFieldId('');
      setFn('count');
      setTargetFieldId('');
      onCreated();
    } catch (e) {
      // 类型×函数非法：服务端 400 文案可见回显，绝不静默
      setError(e instanceof WorkbenchRequestError ? e.message : '添加汇总字段失败');
    } finally {
      setBusy(false);
    }
  }, [tableId, name, relFieldId, fn, targetFieldId, onCreated]);

  if (relationFields.length === 0) return null;

  if (!open) {
    return (
      <button type="button" data-testid="rollup-config-open" onClick={() => setOpen(true)}>
        + 汇总字段
      </button>
    );
  }

  const needsTargetField = fn !== 'count';
  return (
    <div className="rollup-config" data-testid="rollup-config">
      <input
        data-testid="rollup-config-name"
        placeholder="字段名"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        data-testid="rollup-config-relation"
        value={relFieldId}
        onChange={(e) => setRelFieldId(e.target.value)}
      >
        <option value="">选关联字段</option>
        {relationFields.map((f) => (
          <option key={f.field_id} value={f.field_id}>
            {f.name}
          </option>
        ))}
      </select>
      <select
        data-testid="rollup-config-fn"
        value={fn}
        onChange={(e) => setFn(e.target.value as (typeof ROLLUP_FNS)[number])}
      >
        {ROLLUP_FNS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      {needsTargetField && (
        <select
          data-testid="rollup-config-target"
          value={targetFieldId}
          onChange={(e) => setTargetFieldId(e.target.value)}
        >
          <option value="">选目标字段</option>
          {targetFields.map((f) => (
            <option key={f.field_id} value={f.field_id}>
              {f.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" data-testid="rollup-config-submit" disabled={busy} onClick={() => void submit()}>
        添加
      </button>
      <button type="button" data-testid="rollup-config-cancel" onClick={() => setOpen(false)}>
        取消
      </button>
      {error && (
        <span className="rollup-config-error" data-testid="rollup-config-error">
          {error}
        </span>
      )}
    </div>
  );
}
