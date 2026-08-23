/**
 * 视图切换器 —— 视图标签 + 表格/看板切换 + 分组列 + 筛/排 + 隐藏列（路③ Sprint C / S3）
 *
 * 纯展示 + 回调：一切状态与持久化住在 WorkbenchTablePage（视图偏好保存失败的可见提示也在那）。
 * 本组件不吞异常、不走管理端通道、不写死上限。
 *
 * UI 呈现层（Notion 级重做）：筛/排/隐藏列从"一排裸控件"收进点击弹出的精致面板；
 * 底层仍是原生 select/checkbox（testid 不变），只是收进浮层，E2E 打开面板后照旧操作。
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkbenchField, WorkbenchView } from '../lib/workbenchFetch';
import { FieldIcon } from '../lib/workbenchFieldMeta';

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

type PanelId = 'filtersort' | 'properties' | null;

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
  const isKanban = view?.view_type === 'kanban';

  const [panel, setPanel] = useState<PanelId>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const activeFilter = filterFieldId !== '';
  const activeSort = sortFieldId !== '';
  const hiddenCount = hidden.length;

  // 点面板外收起（但面板内的 select/checkbox 操作不算外部，E2E 全程在面板内进行）
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [panel]);

  const toggle = (id: Exclude<PanelId, null>) => setPanel((cur) => (cur === id ? null : id));

  return (
    <div className="view-switcher wb-viewbar" data-testid="view-switcher" ref={barRef}>
      {/* 一排视图标签 */}
      <div className="view-tabs wb-view-tabs">
        {views.map((v) => (
          <button
            key={v.view_id}
            type="button"
            data-testid={`view-tab-${v.view_id}`}
            className={v.view_id === activeViewId ? 'view-tab wb-view-tab active' : 'view-tab wb-view-tab'}
            onClick={() => props.onActivate(v.view_id)}
          >
            <FieldIcon type={v.view_type === 'kanban' ? 'multi_select' : 'text'} className="wb-view-tab-ico" />
            {v.name || '未命名视图'}
            {v.degraded && (
              <span data-testid={`view-degraded-${v.view_id}`} className="view-degraded wb-view-degraded">
                字段已变更
              </span>
            )}
          </button>
        ))}
        <button type="button" className="wb-view-add" data-testid="create-view-button" onClick={props.onCreateView}>
          + 新视图
        </button>
      </div>

      {/* 工具条：视图类型段 + 分组（看板）｜筛/排/隐藏列 面板触发 + 删除视图 */}
      <div className="view-controls wb-toolbar">
        <div className="wb-seg">
          <button
            type="button"
            data-testid="view-to-grid"
            className={`wb-seg-btn${!isKanban ? ' active' : ''}`}
            onClick={() => props.onViewTypeChange('grid')}
          >
            <FieldIcon type="text" /> 表格
          </button>
          <button
            type="button"
            data-testid="view-to-kanban"
            className={`wb-seg-btn${isKanban ? ' active' : ''}`}
            onClick={() => props.onViewTypeChange('kanban')}
          >
            <FieldIcon type="multi_select" /> 看板
          </button>
        </div>

        {isKanban && (
          <label className="wb-group-inline">
            <span className="wb-group-label">分组</span>
            <select
              className="wb-native-select"
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

        <div className="wb-toolbar-spacer" />

        <div className="wb-tool-group">
          <button
            type="button"
            className={`wb-tool-btn${activeFilter || activeSort ? ' on' : ''}`}
            data-testid="filtersort-panel-trigger"
            aria-expanded={panel === 'filtersort'}
            onClick={() => toggle('filtersort')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            筛选与排序
            {(activeFilter || activeSort) && <span className="wb-tool-dot" />}
          </button>

          <button
            type="button"
            className={`wb-tool-btn${hiddenCount > 0 ? ' on' : ''}`}
            data-testid="properties-panel-trigger"
            aria-expanded={panel === 'properties'}
            onClick={() => toggle('properties')}
          >
            <FieldIcon type="single_select" />
            隐藏列{hiddenCount > 0 ? ` · ${hiddenCount}` : ''}
          </button>

          {activeViewId && views.length > 1 && (
            <button
              type="button"
              className="wb-tool-btn wb-tool-danger"
              data-testid={`view-delete-${activeViewId}`}
              onClick={() => props.onDeleteView(activeViewId)}
              title="删除当前视图"
              aria-label="删除当前视图"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 筛选与排序面板 */}
      {panel === 'filtersort' && (
        <div className="wb-panel wb-panel-filtersort" data-testid="view-query">
          <div className="wb-panel-title">筛选</div>
          <div className="wb-panel-row">
            <select
              className="wb-native-select"
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
            <input
              className="wb-input"
              data-testid="filter-value-input"
              placeholder="包含…"
              value={filterValue}
              onChange={(e) => props.onFilterValueChange(e.target.value)}
            />
          </div>
          <div className="wb-panel-title">排序</div>
          <div className="wb-panel-row">
            <select
              className="wb-native-select"
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
            <select
              className="wb-native-select"
              data-testid="sort-dir-select"
              value={sortDir}
              onChange={(e) => props.onSortDirChange(e.target.value)}
            >
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </select>
          </div>
          <button type="button" className="wb-btn wb-btn-primary wb-panel-apply" data-testid="apply-query-button" onClick={props.onApplyQuery}>
            应用
          </button>
        </div>
      )}

      {/* 隐藏列面板（属性开关） */}
      {panel === 'properties' && (
        <div className="wb-panel wb-panel-properties" data-testid="hidden-cols">
          <div className="wb-panel-title">勾选以在本视图隐藏该列</div>
          <div className="wb-prop-list">
            {fields.map((f) => {
              const fid = f.field_id ?? '';
              const shown = !hidden.includes(fid);
              return (
                <label key={fid} className="wb-prop-row" data-testid={`hide-col-label-${fid}`}>
                  <span className="wb-prop-name">
                    <FieldIcon type={f.field_type} />
                    {f.name}
                  </span>
                  {/* checked = 隐藏（与既有语义/testid 完全一致，视觉上是"显示/隐藏"开关的反相） */}
                  <input
                    type="checkbox"
                    className="wb-prop-toggle"
                    data-testid={`hide-col-${fid}`}
                    checked={hidden.includes(fid)}
                    onChange={() => props.onToggleHidden(fid)}
                    aria-label={`${shown ? '隐藏' : '显示'} ${f.name}`}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
