/**
 * 结构化工作台 —— 员工建起第一张表并且删错能还原（Golden Path step1）
 *
 * 五个用户可观察输出，对应 E2E 的五张截图：
 *   01 空工作台显示 ≥2 张开箱模板卡片
 *   02 建表表单：8 类字段各一 + 可见性选择器
 *   03 新表出现在本组织列表，字段数 8
 *   04 删表二次确认：输入表名才能点删除
 *   05 回收站还原后表回到列表，字段定义逐字回归
 *
 * 失败一律显示原因文案，绝不显示成空列表——那会被读成"库里还没有"，
 * 一次静默故障就此隐身（三态文案由服务端错误码分：重新登录 / 没有权限 / 暂时不可达）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  createTable,
  deleteTable,
  getTable,
  listTables,
  listTemplates,
  listTrash,
  restoreTable,
  type FieldType,
  type TrashEntry,
  type WorkbenchField,
  type WorkbenchTable,
  type WorkbenchTemplate,
} from '../lib/workbenchFetch';
import { FieldIcon } from '../lib/workbenchFieldMeta';

function blankFields(): WorkbenchField[] {
  return FIELD_TYPES.map((t, i) => ({
    name: FIELD_TYPE_LABELS[t],
    field_type: t,
    options: t === 'single_select' || t === 'multi_select' ? ['选项一', '选项二'] : [],
    display_order: i,
  }));
}

export default function WorkbenchPage() {
  const [templates, setTemplates] = useState<WorkbenchTemplate[]>([]);
  const [tables, setTables] = useState<WorkbenchTable[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [visibility, setVisibility] = useState<'org' | 'private'>('org');
  const [fields, setFields] = useState<WorkbenchField[]>(blankFields());

  const [deleteTarget, setDeleteTarget] = useState<WorkbenchTable | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getTable>> | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tpl, tbl, tr] = await Promise.all([listTemplates(), listTables(), listTrash()]);
      setTemplates(tpl);
      setTables(tbl);
      setTrash(tr);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitCreate = async (payload: Parameters<typeof createTable>[0]) => {
    try {
      await createTable(payload);
      setCreating(false);
      setNewName('');
      setFields(blankFields());
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '建表失败');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTable(deleteTarget.table_id, confirmName);
      setDeleteTarget(null);
      setConfirmName('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const doRestore = async (id: string) => {
    try {
      await restoreTable(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '还原失败');
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await getTable(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    }
  };

  return (
    <div className="page wb" data-testid="workbench-page">
      <div className="wb-page-head">
        <div>
          <h1 className="wb-title">
            <span className="wb-title-ico">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
                <path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10" />
              </svg>
            </span>
            结构化工作台
          </h1>
          <p className="wb-title-meta">像 Notion 一样，用一张张表把工作组织起来</p>
        </div>
        <button type="button" className="wb-btn wb-btn-primary" data-testid="new-table-btn" onClick={() => setCreating((v) => !v)}>
          {creating ? '收起' : '+ 新建表'}
        </button>
      </div>
      {error && (
        <div className="wb-notice wb-notice-error" data-testid="workbench-error">
          {error}
        </div>
      )}

      {/* 01 空工作台：开箱模板 ≥2 */}
      <section className="wb-section">
        <div className="wb-section-head">
          <h2 className="wb-section-title">开箱模板</h2>
          <p className="wb-section-sub">选一个模板，一键建好带字段的表</p>
        </div>
        <div className="template-grid wb-template-grid" data-testid="template-list">
          {templates.map((t) => (
            <div className="template-card wb-template-card" key={t.template_key} data-testid={`template-${t.template_key}`}>
              <h3>
                <span className="wb-template-emoji">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
                    <path d="M3.5 9.5h17M9 9.5v10" />
                  </svg>
                </span>
                {t.name}
              </h3>
              <p className="wb-template-fields">
                {t.fields.length} 个字段 · {t.fields.map((f) => f.name).join('、')}
              </p>
              <button
                type="button"
                className="wb-btn"
                data-testid={`use-template-${t.template_key}`}
                onClick={() =>
                  void submitCreate({
                    name: `${t.name}-${new Date().toISOString().slice(0, 10)}`,
                    visibility: 'org',
                    template_key: t.template_key,
                  })
                }
              >
                用这个模板建表
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 02 建表表单 */}
      <section className="wb-section">
        {creating && (
          <form
            className="wb-create-card"
            data-testid="create-table-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate({ name: newName, visibility, fields });
            }}
          >
            <div className="wb-form-row">
              <label className="wb-label">
                表名
                <input
                  className="wb-input"
                  data-testid="table-name-input"
                  placeholder="给这张表起个名字"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </label>
              <label className="wb-label">
                可见性
                <select
                  className="wb-native-select"
                  data-testid="visibility-select"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'org' | 'private')}
                >
                  <option value="org">组织可见</option>
                  <option value="private">仅自己</option>
                </select>
              </label>
            </div>
            <div className="wb-field-editor" data-testid="field-editor">
              <div className="wb-field-editor-head">字段（可改名、可换类型）</div>
              {fields.map((f, i) => (
                <div className="field-row wb-field-row" key={f.field_type} data-testid={`field-row-${f.field_type}`}>
                  <span className="wb-field-row-ico">
                    <FieldIcon type={f.field_type} />
                  </span>
                  <input
                    className="wb-input"
                    aria-label={`字段${i + 1}名称`}
                    value={f.name}
                    onChange={(e) =>
                      setFields((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <select
                    className="wb-native-select"
                    aria-label={`字段${i + 1}类型`}
                    value={f.field_type}
                    onChange={(e) =>
                      setFields((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, field_type: e.target.value as FieldType } : x))
                      )
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option value={t} key={t}>
                        {FIELD_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button type="submit" className="wb-btn wb-btn-primary" data-testid="submit-table-btn" style={{ justifySelf: 'start' }}>
              创建表
            </button>
          </form>
        )}
      </section>

      {/* 03 本组织列表 */}
      <section className="wb-section">
        <div className="wb-section-head">
          <h2 className="wb-section-title">我的表</h2>
        </div>
        {loading ? (
          <p className="wb-muted-sm">加载中…</p>
        ) : tables.length === 0 ? (
          <div className="wb-empty" data-testid="table-list">
            <p className="wb-empty-title">还没有任何表</p>
            <p className="wb-empty-sub">用上面的模板，或点「新建表」建你的第一张。</p>
          </div>
        ) : (
          <table className="wb-table-list" data-testid="table-list">
            <thead>
              <tr>
                <th>表名</th>
                <th>可见性</th>
                <th>字段数</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.table_id} data-testid={`table-row-${t.table_id}`}>
                  <td>
                    <button type="button" className="wb-table-name-btn" onClick={() => void openDetail(t.table_id)}>
                      <span className="wb-title-ico">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
                          <path d="M3.5 9.5h17M9 9.5v10" />
                        </svg>
                      </span>
                      {t.name}
                    </button>
                  </td>
                  <td>
                    <span className="wb-vis-pill">{t.visibility === 'org' ? '组织可见' : '仅自己'}</span>
                  </td>
                  <td data-testid={`field-count-${t.table_id}`}>{t.field_count}</td>
                  <td>
                    <div className="wb-row-actions">
                      <Link className="wb-btn" to={`/workbench/tables/${t.table_id}`} data-testid={`open-table-${t.table_id}`}>
                        打开表格
                      </Link>
                      <button
                        type="button"
                        className="wb-btn"
                        data-testid={`delete-btn-${t.table_id}`}
                        onClick={() => {
                          setDeleteTarget(t);
                          setConfirmName('');
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail && (
        <section className="wb-section" data-testid="table-detail">
          <div className="wb-section-head">
            <h2 className="wb-section-title">{detail.name}</h2>
            <p className="wb-section-sub">{detail.fields.length} 个字段</p>
          </div>
          <ul className="wb-trash-list">
            {detail.fields.map((f) => (
              <li key={f.field_id ?? `${f.display_order}`} className="wb-trash-row" data-testid={`detail-field-${f.display_order}`}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <FieldIcon type={f.field_type} />
                  {f.name}
                </span>
                <span className="wb-vis-pill">{f.field_type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 04 删表二次确认：名字没输对，删除按钮就是禁用的 */}
      {deleteTarget && (
        <div className="modal wb-modal-scrim" data-testid="delete-confirm-modal">
          <div className="wb-modal-box">
            <header>
              <h3>删除表</h3>
              <button type="button" className="wb-icon-btn" aria-label="取消" data-testid="cancel-delete-btn" onClick={() => setDeleteTarget(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <p>
              删除后进回收站，30 天内可还原。请输入表名 <strong>{deleteTarget.name}</strong> 以确认：
            </p>
            <input
              className="wb-input"
              data-testid="confirm-name-input"
              placeholder={deleteTarget.name}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
            <div className="wb-modal-actions">
              <button type="button" className="wb-btn" data-testid="cancel-delete-btn-2" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                data-testid="confirm-delete-btn"
                disabled={confirmName !== deleteTarget.name}
                onClick={() => void confirmDelete()}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 05 回收站 */}
      <section className="wb-section">
        <div className="wb-section-head">
          <h2 className="wb-section-title">回收站</h2>
          {trash.length > 0 && <p className="wb-section-sub">删除的表可在此还原</p>}
        </div>
        {trash.length === 0 ? (
          <p className="wb-muted-sm" data-testid="trash-list">
            回收站是空的
          </p>
        ) : (
          <ul className="wb-trash-list" data-testid="trash-list">
            {trash.map((t) => (
              <li key={t.table_id} className="wb-trash-row" data-testid={`trash-row-${t.table_id}`}>
                <span>{t.name} · 可还原至 {t.restorable_until.slice(0, 10)}</span>
                <button type="button" className="wb-btn" data-testid={`restore-btn-${t.table_id}`} onClick={() => void doRestore(t.table_id)}>
                  还原
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
