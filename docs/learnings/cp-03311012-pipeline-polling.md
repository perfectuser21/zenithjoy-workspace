## 重新生成后需要轮询才能看到进度（2026-03-31）

**分支**: cp-03311012-pipeline-polling
**PR**: #105

### 根本原因

`PipelineOutputPage` 数据只在页面 mount 时加载一次（`useEffect([id])`）。
点击「重新生成」后，后端 pipeline 状态已变为 queued → in_progress，但前端没有轮询机制，页面永远停在旧的 completed 快照，用户看不到执行进度。
设计遗漏：触发重跑这个动作需要配套的"状态跟踪"，不能只发一个 POST 就完事。

### 下次预防

- [ ] 任何触发异步操作的按钮（重跑/重试/重新生成），需同时实现状态跟踪（轮询或 WebSocket），而不是只更新按钮状态
- [ ] 轮询必须有终止条件（completed/failed/超时），避免内存泄漏；用 `useRef` 保存 intervalId 并在 unmount 时 `clearInterval`
