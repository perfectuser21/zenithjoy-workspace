# 小改动 PrepPRD：刀2b 安卓端接线 —— AI 保底闭环

## 归属
AI on-call 横切件刀2 安卓段。锚 `line02/keyword_acquisition keep-green`。

## 改什么
**安卓（bump 2.1.37/41）**：新 `uia/LocatorAssistClient.kt`（纯逻辑：请求构造/响应解析/
bounds中心/回执构造 + OkHttp IO 薄层）；`DouyinDmOutreachService` 两个 NO_SEARCH_INPUT
判死点（搜索入口/搜索输入框）判死前先 `tryLocatorAssist`：树快照→求助→候选（viewId 优先
findNodeByIds，无 id 有 bounds 走 tapNodeCenter 手势）→ 本步预期状态即验证闸 →
`reportAssistVerified` 回执（fire-and-forget）。fail-open：求助失败走原判死路径。

**API**：locator-assist 响应补 `assist_id`（INSERT RETURNING）；新端点
`POST /locator-assist/verify {assist_id, verified}` 写 verified 列。

## 验收标准
- [ ] commit-1 RED：客户端纯逻辑 7 例 / 接线源码断言 3 例 / API assist_id+verify 4 例 / smoke 回执段
- [ ] commit-2 转绿 + tsc + 回归；[ ] CI 全绿；[ ] 荣耀X30 装 2.1.37 真机观察出诊
