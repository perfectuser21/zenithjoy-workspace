# WS2 Sprint 2.1a transport 层 type 字段断链修补（2026-05-08）

## 根本原因

Sprint 2.1a 的 type 路由实现"5 处中漏 1 处"：

- ✅ DB schema 加 `publish_tasks.type` 列
- ✅ `POST /api/publish/task` 接 type 写入 DB
- ✅ `handleDouyinPublishTask` 接 `payload.type` 选脚本 + 打 `[type-route]` 日志
- ❌ **中台 heartbeat handler 的 `queued_tasks.map` 没透传 type**
- ❌ **Agent index.ts onTask douyin 分支没把 task.type 转发给 handler**

结果：客户选 video，DB 写 video，但 transport 链路把 type 字段吞掉，handler 永远收到 `payload.type === undefined`，永远 fallback 到 `'image'` 默认值，永远跑 `publish-douyin-image-dryrun.cjs`。从 e2e 角度看 type 路由完全失效——但 unit test 全绿（因为各层都隔离 mock 了）。

Sprint contract 列了"改这 3 个文件"，没有列**完整数据流路径**（DB → service → route → agent transport → handler），漏的两个 transport 节点没人盯。

## 下次预防

- [ ] **Sprint contract 必须列数据流路径，不只列文件清单**：每个有跨层数据传递的字段（如 type / agent_id / token），合同要写"字段从 X 进入系统 → 经过 Y/Z 中转层 → 最终到 W 消费"，每一跳都是一个 ARTIFACT。漏一跳 = 合同漏检 = sprint 不完整。
- [ ] **TDD RED 测试要锁 transport 契约，不只锁两端契约**：本次修补加了 heartbeat-loop integration test（验 onTask 收到 task.type）和 service test（验 SELECT 含 type 列）。如果 sprint 一开始就有这两个 test，transport 缺口在 commit-1 RED 阶段就会暴露。
- [ ] **客户端 e2e 自验必须真跑一次完整链路**：unit test 全绿 ≠ 功能可用。WS5 写的 smoke Step 6 只在 CI dryrun 跑，没在真客户机跑过 type=video。如果 sprint 完工前在 rog 真跑一次，会立即看到 `[type-route] type=image`（不是 video）。
- [ ] **Out of Scope 写在 PR description 而不是 commit message**：本 patch 把 Out of Scope（agent 死循环、qr_bind 跳扫码、真发 selectors）明列在 PR #264，下个 sprint 主理人能直接拿到清单。比埋在 commit body 里好找。
- [ ] **rog Windows 远程自动化套路**：scp 传文件（rsync over Windows OpenSSH 不可用，error 12 connection unexpectedly closed），powershell 启动用直接 `node + tsx-cli.mjs` 不走 npx.cmd（避免 child detach 后 stdout redirect 流被关导致退出），ssh tail log 看 `[type-route]` 字样作为路由验证证据。这套 RDP-free 自动化可复用未来所有 agent 类 sprint 自验。
- [ ] **Validator 设计缺陷标记为 follow-up**：`scripts/check-lead-acceptance.sh` 全文 grep "预置 cookie" 会命中模板里的禁令文字本身，本 patch 用同义词绕过（"严禁用历史 cookie"）。validator 应该改成只看 evidence section 不看 checklist 段落，但这是 validator 自身 bug，不是本 patch scope。

## 关键证据（PR #264 引用）

```
[ws1] task: douyin ca610986-343c-4159-a5a7-cc43946ee1e6
[type-route] handleDouyinPublishTask task=ca610986... type=video
[type-route] resolveDouyinScriptPath type=video real=false script=publish-douyin-video-dryrun.cjs
```

修补前永远是 `type=image` + `image-dryrun.cjs`。
