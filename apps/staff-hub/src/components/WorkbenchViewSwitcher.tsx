/**
 * 视图切换器 —— 视图列表 + 表格/看板切换 + 分组列 + 筛/排 + 隐藏列（路③ Sprint C / S3）
 *
 * 纯展示 + 回调：一切状态与持久化住在 WorkbenchTablePage（视图偏好保存失败的可见提示也在那）。
 * 本组件不吞异常、不走管理端通道、不写死上限。
 */
import type { WorkbenchField, WorkbenchView } from '../lib/workbenchFetch';

interface Props {
  views: WorkbenchView[];
  activeViewId: string | null;
  view: WorkbenchView | null;
  fields: WorkbenchField[];
  filterFieldId: string;
  filterValue: string;
  sortFieldId: string;
  sortDir: string;
  onActivate: (viewId: string) => void;
  onCreateView: () => void;
  onDeleteView: (viewId: string) => void;
  onViewTypeChange: (type: 'grid' | 'kanban') => void;
  onGroupFieldChange: (fieldId: string) => void;
  onToggleHidden: (fieldId: string) => void;
  onFilterFieldChange: (fieldId: string) => void;
  onFilterValueChange: (value: string) => void;
  onSortFieldChange: (fieldId: string) => void;
  onSortDirChange: (dir: string) => void;
  onApplyQuery: () => void;
}

export default function WorkbenchViewSwitcher(props: Props) {
  const {
    views,
    activeViewId,
    view,
    fields,
    filterFieldId,
    filterValue,
    sortFieldId,
    sortDir,
  } = props;
  const singleSelectFields = fields.filter((f) => f.field_type === 'single_select');
  const hidden = view?.hidden_field_ids ?? [];

  return (
    <div className="view-switcher" data-testid="view-switcher">
      <div className="view-tabs">
        {views.map((v) => (
          <button
            key={v.view_id}
            type="button"
            data-testid={`view-tab-${v.view_id}`}
            className={v.view_id === activeViewId ? 'view-tab active' : 'view-tab'}
            onClick={() => props.onActivate(v.view_id)}
          >
            {v.name || '未命名视图'}
            {v.degraded && (
              <span data-testid={`view-degraded-${v.view_id}`} className="view-degraded">
                （引用的字段已变更）
              </span>
            )}
          </button>
        ))}
        <button type="button" data-testid="create-view-button" onClick={props.onCreateView}>
          + 新视图
        </button>
        {activeViewId && views.length > 1 && (
          <button
            type="button"
            data-testid={`view-delete-${activeViewId}`}
            onClick={() => props.onDeleteView(activeViewId)}
          >
            删除当前视图
          </button>
        )}
      </div>

      <div className="view-controls">
        <button
          type="button"
          data-testid="view-to-grid"
          className={view?.view_type === 'grid' ? 'active' : ''}
          onClick={() => props.onViewTypeChange('grid')}
        >
          表格
        </button>
        <button
          type="button"
          data-testid="view-to-kanban"
          className={view?.view_type === 'kanban' ? 'active' : ''}
          onClick={() => props.onViewTypeChange('kanban')}
        >
          看板
        </button>

        {view?.view_type === 'kanban' && (
          <label>
            分组列
            <select
              data-testid="group-field-select"
              value={view?.group_field_id ?? ''}
              onChange={(e) => props.onGroupFieldChange(e.target.value)}
            >
              <option value="">选择单选字段</option>
              {singleSelectFields.map((f) => (
                <option key={f.field_id} value={f.field_id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="view-query" data-testid="view-query">
        <label>
          筛选字段
          <select
            data-testid="filter-field-select"
            value={filterFieldId}
            onChange={(e) => props.onFilterFieldChange(e.target.value)}
          >
            <option value="">不筛选</option>
            {fields.map((f) => (
              <option key={f.field_id} value={f.field_id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <input
          data-testid="filter-value-input"
          placeholder="包含…"
          value={filterValue}
          onChange={(e) => props.onFilterValueChange(e.target.value)}
        />
        <label>
          排序字段
          <select
            data-testid="sort-field-select"
            value={sortFieldId}
            onChange={(e) => props.onSortFieldChange(e.target.value)}
          >
            <option value="">不排序</option>
            {fields.map((f) => (
              <option key={f.field_id} value={f.field_id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <select
          data-testid="sort-dir-select"
          value={sortDir}
          onChange={(e) => props.onSortDirChange(e.target.value)}
        >
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
        <button type="button" data-testid="apply-query-button" onClick={props.onApplyQuery}>
          应用筛选排序
        </button>
      </div>

      <div className="view-hidden-cols" data-testid="hidden-cols">
        <span>隐藏列：</span>
        {fields.map((f) => {
          const fid = f.field_id ?? '';
          return (
            <label key={fid} data-testid={`hide-col-label-${fid}`}>
              <input
                type="checkbox"
                data-testid={`hide-col-${fid}`}
                checked={hidden.includes(fid)}
                onChange={() => props.onToggleHidden(fid)}
              />
              {f.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}
