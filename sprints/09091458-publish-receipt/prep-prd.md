# 小改动 PrepPRD：执行器回执端点 PATCH /api/publish-tasks/:id/receipt（line01 刀3a）

> Brain task cacd7964 · golden_path c5c0e259 · 分支 cp-09091305-publish-receipt

## 改什么
routes/publish-dispatch.ts 的 createPublishTasksRouter 新增 PATCH /:id/receipt：
- 鉴权同现有（X-Upload-Token→tenant）；UUID/跨租户/非 content_publish → 404
- body.result 必须 'success'|'failed'，否则 400 INVALID_RESULT；detail 可选字符串（截 2000）
- 任务已终态（非 pending/queued/dispatched/in_progress/running）→ 200 幂等返回当前 status，不改写
- 否则 UPDATE：status = success→'done' / failed→'failed'；result = COALESCE(result,'{}') || {"receipt":{"result","detail","at"}}；receipt_at=now()
- 响应 {task_id, status}

## 为什么改
执行器（AI+skill 安卓真机）领单发完后需要把结果写回；现有 ack 通道绑死 agent.license_id（AI 执行器无此身份）。回执落库后刀2 编排台自动把结果写回 Notion 行——闭环最后一段。

## 影响范围
只加端点；老 ack/folder_bind 等零接触。判定点：无接缝判定点（N/A）。守卫：逻辑=vitest；全链路=扩 content-publish-dispatch-smoke.sh 一步（领单后回执→DB 断言 status）。

## 验收标准
- [ ] commit-1 失败测试（401/404/400/幂等/成功done/失败failed+result合并）
- [ ] commit-2 转绿；smoke 扩步；CI 全绿
