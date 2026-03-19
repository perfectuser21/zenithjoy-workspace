---
branch: cp-03191956-content-factory-pipeline
date: 2026-03-19
type: learning
---

# Learning: 内容工厂前端创建入口

## 做了什么
ContentFactoryPage 从纯只读看板升级为可操作页面：
- 新增创建表单（keyword + series 下拉 + notebook_id/angle 可选）
- Pipeline 卡片增加 4 阶段进度条（research→generate→review→export）
- 看板按 pipeline status 分列（排队/进行/完成/异常）

## 关键发现

### 1. Pipeline status 与子任务 status 不同
Pipeline 本身的 status 是 queued/in_progress/completed/failed/quarantined，
而子任务（content-research 等）有自己的 status。
前端看板应该按 Pipeline 的 status 分列，不是按子任务 stage 分列。

### 2. Brain API 返回格式不一致
GET /api/brain/pipelines 有时返回数组，有时返回 { pipelines: [] }。
前端做了兼容处理：`Array.isArray(data) ? data : data.pipelines || []`

### 3. content-types API 已有
GET /api/brain/content-types 已经可以返回注册的内容类型列表，
前端直接调用作为 series 下拉数据源，不需要硬编码。

## 后续
- Brain 侧 executor 实现（NotebookLM 拉取 + Generate + Review + Export）
- 前端对接子任务查询 API，让进度条反映真实阶段
- 审核通过/打回按钮对接 API
