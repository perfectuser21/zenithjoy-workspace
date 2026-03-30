# Learning: content-factory-notebook-pipeline-detail

**Branch**: cp-03301715-content-factory-notebook-pipeline-detail
**PR**: #94
**Merged**: 2026-03-30

## 什么有效

### 1. 自动填入模式（from config → form field）
选内容类型 → 用 `useEffect([contentType])` 请求 `/api/brain/content-types/:type/config` → 拿 `notebook_id` → `setNotebookId`。简洁有效，不需要额外状态管理。

### 2. 按需加载 Stage 详情
PipelineCard 不在渲染时预加载 stages，而是点击"步骤"按钮时 lazy fetch。避免了 Kanban 列表初始化时 N 个并发请求。

### 3. TopLevel config field 模式
`notebook_id` 直接存在 config 顶层（`{ notebook_id: "xxx", template: {...} }`）而不是嵌套在 sub-key 里。取值简单（`config?.notebook_id`），API 透传也直接。

## 根本原因

pipeline 每次需要手动填 notebook_id 是因为：
1. 内容类型配置没有 `notebook_id` 字段——没有地方存
2. 创建表单选类型后没有触发配置查询——有地方查但没查

两个独立 gap 叠加导致用户每次都要手动填。

## 下次预防

- [ ] 新建表单有「关联配置」字段时，默认用 `useEffect([selectedType])` 自动填入，不要设计成纯手动
- [ ] 内容类型 schema 文档化哪些字段是「pipeline 必需」，确保 YAML 和 DB config 都有
- [ ] `.dev-mode` 中 `tasks_created: true` 标记要在 Stage 1 Spec 完成后立刻写入，不要等到 Stage 2 才发现缺失

## 后续（未做）
- 后端：`tick.js` 过滤 content-pipeline 子任务（独立 Cecelia 任务）
- 后端：DB migration 让 `tasks_task_type_check` 永久包含新 stage 类型
- 后端：content-pipeline executors 保存 stage input/output/prompt
- YAML：给 `solo-company-case.yaml` 加 `notebook_id` 字段（目前只在 DB config 里存）
