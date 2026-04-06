# Learning: content-factory-notebook-pipeline-detail

**Branch**: cp-03301715-content-factory-notebook-pipeline-detail  
**PR**: #94  
**Merged**: 2026-03-30

## 什么有效

### 1. 自动填入模式（from config → form field）
选内容类型 → 用 `useEffect([contentType])` 请求 `/api/brain/content-types/:type/config` → 拿 `notebook_id` → `setNotebookId`。简洁有效，不需要任何额外状态管理。

### 2. 按需加载 Stage 详情
PipelineCard 不在渲染时预加载 stages，而是点击"步骤"按钮时 lazy fetch。避免了 Kanban 列表初始化时 N 个并发请求。

### 3. TopLevel config field 模式
`notebook_id` 直接存在 config 顶层（`{ notebook_id: "xxx", template: {...} }`），而不是嵌套在某个 sub-key 里。这样前端取值简单（`config?.notebook_id`），API 透传也直接。

## 陷阱

### 1. `.dev-mode` 缺少 `tasks_created: true` 会被 Hook 阻止写代码
branch-protect.sh 检查 `tasks_created: true`，在创建完所有 Task 后必须立刻在 `.dev-mode` 文件中标记，否则 Edit 工具会被拒绝。

### 2. worktree 中 npm install 路径
在 worktree 里执行 `npm run build` 需要先从 worktree 根目录 `npm install --workspace=apps/dashboard`，否则 vite.config.ts 找不到 `@vitejs/plugin-react`（依赖在主仓库 node_modules）。

## 后续（未做）
- 后端：`tick.js` 过滤 content-pipeline 子任务（独立 Cecelia 任务）
- 后端：DB migration 让 `tasks_task_type_check` 永久包含新 stage 类型
- 后端：content-pipeline executors 保存 stage input/output/prompt 以便前端展示更丰富
- YAML：给 `solo-company-case.yaml` 加 `notebook_id` 字段（目前只能在 DB 里存）
