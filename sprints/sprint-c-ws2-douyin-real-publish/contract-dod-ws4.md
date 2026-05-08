---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: 抖音首次扫码绑定 UI + 任务路由

**范围**: Dashboard 加绑定按钮 + 中台 qr_bind:douyin 任务路由 + Agent 执行扫码 + Dashboard 显示 QR
**大小**: M
**依赖**: WS3（需要 qr-login 模块）

## ARTIFACT 条目

- [ ] [ARTIFACT] Dashboard 含"绑定抖音"按钮组件
  Test: grep -rE "(绑定抖音|绑定 抖音|bind.*douyin)" apps/dashboard/src/ | head -1 | grep -q .

- [ ] [ARTIFACT] 中台 publish 路由识别 qr_bind:douyin platform
  Test: grep -rE "qr_bind:douyin|qr_bind_douyin" apps/api/src/ | head -1 | grep -q .

- [ ] [ARTIFACT] Agent qr-bind handler 接入 qr-login 模块
  Test: grep -E "require.*lib/qr-login" services/agent/src/handlers/qr-bind-douyin.ts || grep -E "qr-login" services/agent/src/handlers/qr-bind-douyin.ts

- [ ] [ARTIFACT] Agent 完成时回写 result.cookie_local_path 字段
  Test: grep -rE "cookie_local_path" services/agent/src/handlers/qr-bind-douyin.ts | head -1 | grep -q .

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/qr-bind-douyin-flow.test.ts`，覆盖：
- POST /api/publish/task {platform:'qr_bind:douyin'} 写入任务 status=queued
- Agent task complete 时 result 含 cookie_local_path → DB result JSONB 持久化
- Dashboard 轮询 task GET 拿到 result.qr_screenshot 字段（base64 或 path）
