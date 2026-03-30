# Learning: PipelineOutputPage UI 重设计

**分支**: cp-03302038-pipeline-output-redesign
**日期**: 2026-03-30

## 根本原因

1. **视觉不一致问题的根因**：PipelineOutputPage 是在较早阶段创建的，当时 WorksGalleryPage 的 slate/violet 设计语言尚未形成项目标准。两个页面独立开发，缺乏共享的设计 token，导致 indigo/gray 与 slate/violet 共存。解决方法：将 WorksGalleryPage 作为主参考标准，新功能页面应先对比参考页面的颜色方案再动手。

2. **时间显示 "0s" 的根因**：Pipeline 任务通过批量 SQL 插入（`INSERT INTO ... VALUES (...), (...)`），所有子任务的 `started_at`/`completed_at` 在毫秒级内完成，导致 `formatDuration` 计算出 0-1ms。`Math.round(ms/1000)` 对于 0ms 返回 0，最终显示 "0s"。修复：在 `<1s` 的情况单独处理，返回有意义的 "< 1s" 字符串而非误导性的 "0s"。

3. **DoD Test 命令引号嵌套陷阱**：在 Bash 中 `manual:node -e "..."` 内部嵌套包含单引号的字符串（如 `activeTab === 'article'`）时，bash quoting 会导致 `node -e` 参数被截断。规避方法：在 Test 命令中避免嵌套单引号，改用不含引号的字符串模式（如直接搜索 `'article'` 本身的片段）或将 node 脚本写入临时文件。

## 影响

- PipelineOutputPage 现在与 WorksGalleryPage 视觉统一，用户体验一致性提升
- 阶段时间显示更准确，不再误导用户认为 pipeline 步骤"耗时 0 秒"
- Hero 封面图展示让产出内容更直观，无需手动切换到"图片"Tab

## 建议

新建前端页面时，先在 WorksGalleryPage 中搜索同类组件的颜色用法，用 `bg-slate-*`/`text-slate-*`/`bg-violet-*` 替代 gray/indigo 系，保证全局一致性。
