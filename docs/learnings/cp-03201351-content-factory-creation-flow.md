---
branch: cp-03201351-content-factory-creation-flow
date: 2026-03-20
type: learning
---

# Learning: 内容工厂创作链路

## 做了什么
打通内容工厂前端到西安 Codex 的创作链路：执行按钮、平台选择、产出预览、自动轮询。

## 关键决策

### 1. 全部移到西安 Codex 执行
- 验证了 Codex（GPT-5.4）+ card-renderer.mjs 模板 = Claude Code 同等质量
- Codex 直接调 /share-card skill 时品牌规范不遵守（30% 遵守率）
- 用模板兜底品牌规范后，Codex 只需输出 JSON config，质量一致
- task-router content-* 路由从 us 改为 xian

### 2. 模板 vs LLM 直接生成卡片
- LLM 直接写 SVG 代码 → 模型差异导致质量不一致
- card-renderer.mjs 模板固定品牌规范 → 任何 LLM 只需输出 JSON → 质量稳定
- 模板路径：~/claude-output/scripts/card-renderer.mjs（已部署到西安）

### 3. 手动触发 vs Tick 调度
- Tick 调度器已停（dispatch_enabled=null），短期内不修
- 加了 POST /pipelines/:id/run API，前端手动触发，不依赖 tick
- 有活跃 pipeline 时轮询间隔从 30 秒降到 5 秒

## 踩坑

### CI 分钟数耗尽
- zenithjoy-workspace 是私有仓库，GitHub Actions 分钟数用完
- 症状：所有 job 2 秒内失败，steps: []（runner 分配失败）
- 解决：改为 public 仓库

### Codex-bridge cwd 不存在
- 派发任务时 work_dir 指定了西安不存在的路径 → spawn ENOENT
- Node.js spawn 的 cwd 不存在时报 ENOENT，容易误以为是二进制文件缺失

### 西安依赖部署清单
同步到西安的依赖：notebooklm-py（pip）、resvg（npm）、storage_state.json（登录态）、3 个 skills（notebooklm/content-creator/share-card）、card-renderer.mjs
