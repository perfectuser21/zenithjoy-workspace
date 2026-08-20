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
    <div className="page" data-testid="workbench-page">
      <h1>结构化工作台</h1>
      {error && (
        <div className="error-banner" data-testid="workbench-error">
          {error}
        </div>
      )}

      {/* 01 空工作台：开箱模板 ≥2 */}
      <section>
        <h2>开箱模板</h2>
        <div className="template-grid" data-testid="template-list">
          {templates.map((t) => (
            <div className="template-card" key={t.template_key} data-testid={`template-${t.template_key}`}>
              <h3>{t.name}</h3>
              <p>{t.fields.length} 个字段：{t.fields.map((f) => f.name).join('、')}</p>
              <button
                type="button"
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
      <section>
        <button type="button" data-testid="new-table-btn" onClick={() => setCreating((v) => !v)}>
          {creating ? '收起' : '新建表'}
        </button>
        {creating && (
          <form
            data-testid="create-table-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate({ name: newName, visibility, fields });
            }}
          >
            <label>
              表名
              <input
                data-testid="table-name-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </label>
            <label>
              可见性
              <select
                data-testid="visibility-select"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'org' | 'private')}
              >
                <option value="org">组织可见</option>
                <option value="private">仅自己</option>
              </select>
            </label>
            <div data-testid="field-editor">
              {fields.map((f, i) => (
                <div className="field-row" key={f.field_type} data-testid={`field-row-${f.field_type}`}>
                  <input
                    aria-label={`字段${i + 1}名称`}
                    value={f.name}
                    onChange={(e) =>
                      setFields((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <select
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
            <button type="submit" data-testid="submit-table-btn">
              创建
            </button>
          </form>
        )}
      </section>

      {/* 03 本组织列表 */}
      <section>
        <h2>我的表</h2>
        {loading ? (
          <p>加载中…</p>
        ) : (
          <table data-testid="table-list">
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
                    <button type="button" onClick={() => void openDetail(t.table_id)}>
                      {t.name}
                    </button>
                  </td>
                  <td>{t.visibility === 'org' ? '组织可见' : '仅自己'}</td>
                  <td data-testid={`field-count-${t.table_id}`}>{t.field_count}</td>
                  <td>
                    <Link to={`/workbench/tables/${t.table_id}`} data-testid={`open-table-${t.table_id}`}>
                      打开表格
                    </Link>
                    <button
                      type="button"
                      data-testid={`delete-btn-${t.table_id}`}
                      onClick={() => {
                        setDeleteTarget(t);
                        setConfirmName('');
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail && (
        <section data-testid="table-detail">
          <h2>{detail.name}</h2>
          <ul>
            {detail.fields.map((f) => (
              <li key={f.field_id ?? `${f.display_order}`} data-testid={`detail-field-${f.display_order}`}>
                {f.display_order}. {f.name}（{f.field_type}）
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 04 删表二次确认：名字没输对，删除按钮就是禁用的 */}
      {deleteTarget && (
        <div className="modal" data-testid="delete-confirm-modal">
          <p>
            删除后进回收站，30 天内可还原。请输入表名 <strong>{deleteTarget.name}</strong> 以确认：
          </p>
          <input
            data-testid="confirm-name-input"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
          <button
            type="button"
            data-testid="confirm-delete-btn"
            disabled={confirmName !== deleteTarget.name}
            onClick={() => void confirmDelete()}
          >
            确认删除
          </button>
          <button type="button" data-testid="cancel-delete-btn" onClick={() => setDeleteTarget(null)}>
            取消
          </button>
        </div>
      )}

      {/* 05 回收站 */}
      <section>
        <h2>回收站</h2>
        <ul data-testid="trash-list">
          {trash.map((t) => (
            <li key={t.table_id} data-testid={`trash-row-${t.table_id}`}>
              {t.name}（可还原至 {t.restorable_until.slice(0, 10)}）
              <button type="button" data-testid={`restore-btn-${t.table_id}`} onClick={() => void doRestore(t.table_id)}>
                还原
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
