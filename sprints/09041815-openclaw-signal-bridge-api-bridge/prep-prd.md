# 小改动 PrepPRD（路径 B）：OpenClaw 信号桥·件2 — 中台设备指令桥端点

Brain task: `3cf92772-03c3-41ca-8944-a2735bc3764d`（已 claim）
决策: `7a4c0369` ｜ GP 锚: `line02/keyword_acquisition keep-green` ｜ 系列: openclaw-signal-bridge（件2/3）
前置: 件1 PR#1762 已合并（设备端 8 原语 + cmd/cmd_result 协议）

## 改什么

中台新增**设备指令桥**：`POST /api/devices/:agentId/actions` 接收指令 → 经 ws0 下发 `cmd` → 按 correlation 等待 `cmd_result` → 同步返回回执。红线防护在此层代码强制。

### 数据流

```
调用方(件3 phonectl / 内部) → POST /api/devices/:agentId/actions {action, ...args, timeoutMs?}
  → 限流(先于鉴权,CodeQL) → workerPostAuth(license/内部token 双鉴权,复用 PR#1748)
  → 租户远程协助开关(新表,fail-closed) → action 白名单(8 个已知) → 频控(log 表窗口 count)
  → makeMsg('cmd', payload) → sendToAgent(agentId UUID) [不可达→503]
  → CommandBridge 挂 pending(msgId→resolver) → 设备执行 → cmd_result 上行(payload.inReplyTo=msgId)
  → resolve → 200 {ok, errorCode?, foregroundPkg, data}；超时→504 DEVICE_TIMEOUT
  → 全程写 device_command_log(审计+频控数据源)
```

### 新建（apps/api）

| 件 | 内容 |
|---|---|
| `routes/devices.ts` | 端点；1:1 复刻 workers-executor.ts 骨架（requireAgentUuid 400 守卫 / 限流先于鉴权 / ERR-OK 信封） |
| `services/command-bridge.ts` | pending map（msgId→{resolve,timer}）；dispatch+await；超时清理；并发上限（每设备同时 1 条在途——设备端本来就串行队列，多发只是排队占超时预算） |
| `migrations/*_device_command_bridge.sql` | `zenithjoy.remote_control_config`（tenant_id PK, enabled bool DEFAULT true, actions_per_minute int DEFAULT 60, taps_per_minute int DEFAULT 30）+ `zenithjoy.device_command_log`（id, tenant_id, agent_id, msg_id UNIQUE, action, ok, error_code, latency_ms, created_at；索引 (tenant_id, created_at)） |
| schemas/agent-protocol.ts 改 | ServerMessageSchema 加 `cmd` 分支；AgentMessageSchema 加 `cmd_result` 分支（**不加 = zod 直接丢弃上行**，Explore 实证） |
| services/agent-ws.ts 改 | message 分发链加 `cmd_result` → `commandBridge.resolve(payload.inReplyTo, payload)` |
| app.ts 改 | 挂载 `/api/devices` |

### 红线防护（本件核心，全部 fail-closed；对抗审查 5P1 已吸收）

1. **鉴权只走 internalAuth，砍掉 license 路径**（对抗 P1-3/P1-4）：调用方是件3 phonectl/内部编排，license 路径是负资产——客户手机上的 license 被提取即可横向驱动同租户全部设备（含 screenshot 读屏）。且 production 环境 `ZENITHJOY_INTERNAL_TOKEN` 未配置时**直接 503 拒服务**（internalAuth 原生 fail-open，必须包守卫），配 proven-to-fire 测试
2. **租户开关**：`remote_control_config.enabled`；无行→默认 true（Alex 拍板）；**DB 查询失败→拒绝**；tenant 一律从 `zenithjoy.agents.tenant_id` 按 :agentId 推导，**绝不信请求体**（对抗 P2）
3. **action 白名单**：仅 8 个已知 action；未知→400（不透传任意字符串给设备）
4. **频控原子化**（对抗 P1-5 TOCTOU）：log 行在 dispatch **前** INSERT（status='pending'，回执后 UPDATE ok/latency/error_code），count 含 pending 行，用单条 `INSERT ... SELECT ... WHERE count < limit` 原子写入判定；count/INSERT 失败→拒。actions_per_minute 默认 60（screenshot 计入，防免费投屏）+ taps_per_minute 默认 30；超限→429
5. **语义红线声明**：私信/关注/点赞是语义层动作原语层无法识别——防线=频控+审计（log 不含 args，type 的 text 不落库：隐私优先，审计只到 action 名，此取舍显式声明）；语义级识别留给 OpenClaw skill 层

### 契约硬语义（对抗审查修正）

- **504 DEVICE_TIMEOUT = 结果未知（unknown outcome），不是未执行**——设备无取消机制，指令在设备队列里照样执行。响应体必须带 `"outcome":"unknown"`，调用方禁止盲重试（重试→双击/重发私信=业务事故）。可选 `idempotencyKey` 参数作为 msgId：同 key 重发天然吃设备端 done 缓存实现"结果重取"（件1 能力激活）
- **timeoutMs 服务端说了算**：入参 clamp 到 [3000, 35000]，默认 35000
- **pending 时序原子契约**：resolve/timeout 都先 delete pending 再动作；迟到回执查无 entry → 只 UPDATE log 不 INSERT（防 msg_id UNIQUE 炸）；在途占位（每设备 1 条）在任何 await 之前同步完成，第二并发请求→409 DEVICE_BUSY
- **设备掉线即时失败**：bridge 订阅 registry unregister 事件→该设备全部 pending 立即 502 AGENT_DISCONNECTED（不白等 35s）；resolve 校验回执来源 agentId===pending.agentId，不符丢弃告警
- **旧版 agent 快速失败**：下发前查 hello meta.version，无件1 能力→409 AGENT_TOO_OLD（旧 agent 对 cmd 静默丢弃，不拦=白烧 35s）
- **限流挂具体 route**（router.use 层 params 恒空的 workers-executor 潜伏 bug 不复制）
- **单副本约束注记**：pending map 在内存，prod 单容器成立；水平扩容前桥必须改共享存储（代码注释+PRD 双写）

### 顺手修的既有 bug（对抗 P1-1，随本件 PR）

`agent-registry.unregister` 只按 agentId 删不校验 ws 身份——快速重连时旧 socket 的 close 会误删新连接 entry，设备"在线却 503"且 DB 误标 offline。修法：`unregister(agentId, ws)` 仅 `entry.ws === ws` 时删除；配 failing test（注册新连接→触发旧连接 close→断言 entry 仍在）

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 回执关联 | ①顶层 taskId（task_result 同款） ②payload.inReplyTo | ② | 件1 设备端 sendResult 顶层 msgId 是新生成的，原请求 id 在 payload.inReplyTo（Explore 实证 WsClient.kt:155） | 用①永远关联不上，全部 504 |
| 设备不可达判定 | ①下发后等超时 ②sendToAgent 返回 false 立即 503 | ② | agent-registry readyState 检查现成 | 用①白等 35s |
| 开关缺省语义 | ①无配置行=关 ②无配置行=开、DB 错误=拒 | ② | Alex 拍板默认开；fail-closed 只对故障态 | 用①=全量瘫痪；DB 故障放行=闸形同虚设 |

## 前置（已确认）

- [x] 件1 协议已合并（cmd/cmd_result、8 action、错误码表）
- [x] workerPostAuth 中间件现成（PR#1748）；sendToAgent/makeMsg 现成
- [x] migration runner 现成（npm run migrate，幂等约定）
- [x] vitest+supertest 先例齐（workers-executor.test.ts / agent-ws.test.ts 假 socket 姿势）

## 不包含

- 件3 phonectl CLI；OpenClaw 侧 skill
- SSE/长轮询流式回执（同步等待够用，35s 上限）
- 语义级红线识别（见上声明）
- 真机 E2E（件3 后端到端首验）

## 验收标准

- [ ] commit-1 failing tests 先行（bridge 超时/resolve/并发、路由鉴权/开关/白名单/频控/503/504、schema 双向 parse）
- [ ] commit-2 实现转绿；coverage ≥65% 门槛不破
- [ ] smoke: `.github/workflows/scripts/smoke/device-command-bridge-smoke.sh` 进 CI + smoke-baseline 登记
- [ ] 守卫 proven-to-fire：频控超限拒绝测试先见红
- [ ] PR 声明 GP 锚 keep-green
