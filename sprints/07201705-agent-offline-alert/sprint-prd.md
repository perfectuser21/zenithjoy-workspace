# Sprint PRD — Agent 离线静默告警（07201705）

task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
sprint_dir: sprints/07201705-agent-offline-alert
journey_type: ops_infra
target_environment: windows_cloud

---

## 立案证据

Issue 61d16207：XIAN-PC 07-18 起 Windows Agent 无声离线 2 天，07-20 才被发现。
Overlay 红灯依赖实时心跳，Agent 进程若在心跳更新前已死则红灯不亮 → 无声离线 2 天。

---

## 范围（thin-slice）

**做**：
1. 中台定时扫描：`zenithjoy.agents.updated_at` 超阈值（默认 4h，`AGENT_OFFLINE_THRESHOLD_HOURS` env 可配），且此前在线的 Windows Agent → 推飞书 webhook 告警
2. 推送渠道复用仓内现有 `FEISHU_ALERT_WEBHOOK`（`wechat-heartbeat.ts` 已使用同 env），禁止硬编码 URL
3. 去重：同机同次离线只推一次；恢复心跳时推恢复通知并复位
4. Dashboard 机器列表：离线时长徽标（如已有字段 `last_seen` 支持则不动；否则新增 `offline_since` 字段显示）
5. E2E smoke：造 stale 心跳行 → 触发扫描 → 断言 webhook mock 收到 payload（含 hostname/离线时长）；恢复场景断言恢复通知；变异测试：注释推送调用 → E2E 红（proven-to-fire）

**不做**（刀B）：短信/电话渠道、Android agent 特化、boot-fail 上报、Bark 渠道

---

## Invariant 约束

| ID | 约束 |
|----|------|
| INV-01 | 失败路径禁 warning 降级（9202c14e）：推送失败必须 `throw`/打 `console.error`，禁止 `console.warn` 静默吞错 |
| INV-02 | 不硬编码 webhook URL；`FEISHU_ALERT_WEBHOOK` 来自 GHA Secrets / `~/.credentials/feishu.env` |
| INV-03 | 同机同次离线去重：内存 Set 或 DB 标记，复位条件 = `updated_at` 刷新到阈值内 |
| INV-04 | smoke 进 baseline：新 `agent-offline-alert-smoke.sh` 必须加入 CI nightly |
| INV-05 | 新 `.test.ts` 文件登记进 `docs/registry/` |
| INV-06 | TDD 顺序：commit-1 写失败 E2E/smoke → commit-2 写实现，违反 → `lint-tdd-commit-order` 拦截 |
| INV-07 | 告警 payload 必须含 `hostname`、`offline_duration_minutes`（整数）、`agent_id` |

---

## 累积 FR

| ID | 功能需求 |
|----|---------|
| FR-01 | `apps/api/src/services/agent-offline-monitor.ts`：`startAgentOfflineMonitor()` 每分钟轮询，发现超阈值在线 Windows Agent → 调 `sendOfflineAlert()` |
| FR-02 | 告警去重状态：进程内 `Map<string, Date>` 记录已告警的 `agent_id` → 首次告警时写入，`updated_at` 刷新到阈值内时删除（推恢复通知） |
| FR-03 | `sendOfflineAlert(agent)` 调 `FEISHU_ALERT_WEBHOOK`（POST JSON `{msg_type:'text', content:{text:...}}`），失败抛错（INV-01） |
| FR-04 | 阈值可配：`AGENT_OFFLINE_THRESHOLD_HOURS`（默认 4），`AGENT_SCAN_INTERVAL_MS`（默认 60000）；`env-registry.ts` 补注册 |
| FR-05 | `apps/api/src/index.ts`：`startAgentOfflineMonitor()` 在 `server.listen` 回调内调用（同 `startStaleListenerMonitor` 位置） |
| FR-06 | Dashboard 机器列表 `GET /api/agent/machines`：响应新增 `offline_minutes: number | null`（在线时为 null，离线时 = Math.floor((now - last_seen) / 60000)） |
| FR-07 | E2E smoke `agent-offline-alert-smoke.sh`：① psql 造 stale 行（`updated_at = NOW() - INTERVAL '5h'`, `status='online'`, `platform='windows'`）② POST `/api/internal/agent-offline-scan`（内部触发端点）③ 断言 webhook mock server 收到含 hostname/offline_duration_minutes 的 payload ④ 恢复场景：UPDATE `updated_at = NOW()`，再 scan，断言推恢复消息 |
| FR-08 | 变异测试（proven-to-fire）：注释 `sendOfflineAlert()` 调用 → smoke 必须红（在 smoke 内用 `set +e` + 断言非零退出码验证） |

---

## NFR

| 维度 | 要求 |
|------|------|
| 性能 | 扫描 SQL：`WHERE status='online' AND platform='windows' AND updated_at < NOW() - INTERVAL`，加 idx 若无 |
| 可观测性 | `console.info` 打每次扫描结果（多少机在线/多少超阈）；告警发送成功/失败打 `console.info`/`console.error` |
| 向后兼容 | `GET /api/agent/machines` 新增字段可选；现有 smoke `machines-smoke.sh` 不改 |
| 测试覆盖 | vitest 单测覆盖：去重逻辑 / 阈值计算 / 推送失败抛错（不 warn）；smoke 覆盖端到端链路 |
| 部署 | 纯 API 侧变更，不需要重新部署 Windows Agent 客户端 |

---

## 现有仓库依赖（已确认）

- 告警通道：`FEISHU_ALERT_WEBHOOK`（`apps/api/src/services/wechat-heartbeat.ts` 同一 env，GHA Secret 已配）
- 调度模式：参考 `startStaleListenerMonitor()`（每分钟 setInterval，.unref() 不阻止进程退出）
- 飞书推送模式：`{msg_type:'text', content:{text:...}}` POST JSON（`wechat-heartbeat.ts` L38-45）
- agents 表关键字段：`agent_id(text)`, `hostname(text)`, `platform(text)`, `status(text)`, `updated_at(timestamptz)`, `last_seen(timestamptz)`
- 现有 machines 路由：`apps/api/src/routes/agent-machines.ts`（`GET /api/agent/machines` 需加 `offline_minutes`）

---

## 工作切片（顺序）

```
WS1 — E2E smoke 写先（failing）
  - agent-offline-alert-smoke.sh（≥10 行实质内容，非占位）
  - 含变异测试段

WS2 — DB 侧：内部触发端点 POST /api/internal/agent-offline-scan
  - 查 stale Windows agents，推 webhook mock，返回 {scanned, alerted[]}
  - vitest 单测

WS3 — 进程守护：startAgentOfflineMonitor()
  - agent-offline-monitor.ts + 接入 index.ts
  - 去重 Map + 恢复通知
  - vitest 覆盖去重/恢复/推送失败抛错

WS4 — Dashboard offline_minutes 字段
  - agent-machines.ts GET / 加 offline_minutes
  - machines-smoke.sh 保持绿（字段可选，不改现有断言）

WS5 — smoke 加入 CI nightly baseline + registry 登记
```

---

## Path 声明

本 PR 不推进 Path 1/2/4 的 Step，属于 **Ops Infra**（非 user_facing Journey）。
声明：本 Sprint 保持 golden-path-1-smoke.sh 全绿。
