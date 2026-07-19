# Contract Draft — GP-A 主动语音触达：派发链路与触发入口

task_id: 2ac0e77b-c2e3-47e9-92dd-7549622835d7
sprint_dir: sprints/07191407-gpa-dispatch-trigger
生成时间: 2026-07-19
轮次: 1（首轮）

---

## 一、本次 Sprint 边界

**推进声明**：本 PR 把 GP-A 主动语音触达从「skeleton」（PR #1397 三个孤立 Feature 已验证）推进到「thin」（完整可用 Golden Path）。

**目标 Path**：GP-A 主动语音触达（Journey ID: 55d26529-2274-4c30-85fe-168edcef4d76）

**Steps 覆盖**：
- Step 1：触发层（双入口 — 手动 CRM 按钮 + 自动规则引擎）
- Step 2：call 入库 + 去重校验（10min 技术窗口）
- Step 3：Agent 轮询认领（GET /pending 乐观锁）
- Step 4：子进程 RPA 拨号（call_phase 原子推进）
- Step 5：接通后 AI 对话真接线（make_voice_call → start_audio_bridge）
- Step 6：通话结束 + 回写（transcript + call_phase 终态）
- Step 7：通话记录可见（CRM 列表列 + 标签页 + ASR 转写）

---

## 二、技术断言（用户语言 → 可验证断言）

### 用户语言描述
「客服在 CRM 点呼叫按钮后，Agent 能自动认领任务并拨号，通话结束后在 CRM 能看到通话记录和对话转写」

### 可验证技术断言

| # | 用户可见/感知 | 技术断言 | 验证层 |
|---|------------|---------|-------|
| T-1 | 鉴权修复后点击呼叫不再 404 | POST /api/cs/voice-outreach/call 鉴权为 requireCsAdminOrSuperAdmin，代码层 grep 确认无 requireCsWriteAccess('wechatId') | CI smoke |
| T-2 | 10 分钟内重复点击不重复拨 | 同 tenant_id+contact_name+wechat_account 10min 内第二次 POST /call 返回 409 DUPLICATE_CALL | CI vitest + smoke |
| T-3 | 任务写入后 Agent 能看到并认领 | GET /pending 返回 queued 记录，JSON 含 call_phase 字段 | CI smoke |
| T-4 | 认领是原子的，不会产生两个子进程 | 两个并发 UPDATE WHERE call_phase='queued' RETURNING，只有一行回来 | CI vitest (dispatcher) |
| T-5 | 子进程确认 dialing 是原子的，防重复拨打 | UPDATE WHERE call_phase='claimed' RETURNING 0 行时 make_voice_call 不被调用 | CI vitest (worker) |
| T-6 | AI 对话真正接线（不再是 TODO） | make_voice_call() 内部调用 start_audio_bridge()，代码层 grep 确认 | CI smoke |
| T-7 | 通话结束后 ASR 转写写入 DB | POST /records 接受 transcript 字段，DB 字段存在（migration 断言）| CI smoke |
| T-8 | CRM 能看到通话记录 | GET /records 返回含 call_phase/transcript/trigger_source 字段的数组 | CI vitest |
| T-9 | 5 次快失败后 Agent 停止认领+飞书告警 | dispatcher 熔断逻辑：60min 窗口内 5 次 <30s 快失败 → circuit_open=True | CI vitest (dispatcher) |
| T-10 | 自动规则 dry-run 不真实拨打 | rule_engine dry_run=True 时不写 voice_call_records 行 | CI vitest (rule_engine) |
| T-11 | 3 天冷却期内自动规则不重复触发 | no_answer 终态后 3 天内 rule_engine 跳过该联系人 | CI vitest (rule_engine) |
| T-12 | Agent 重启不产生第二个子进程 | 锁文件存在且 PID 活跃时 dispatcher 跳过认领 | CI vitest (dispatcher) |
| T-13 | DB 故障时 Agent 轮询不中断 | GET /pending DB 抛异常时返回 200 {data: []}（I-13 降级） | CI vitest |
| T-14 | voice_outreach_rules 表支持规则管理 | table + condition_expr/dry_run/cooldown_days 字段在 migration 中存在 | CI smoke |

---

## 三、E2E 验收

### CI 可达段（smoke + vitest，自动运行）

```
新文件: .github/workflows/scripts/smoke/gpa-dispatch-trigger-smoke.sh
```

覆盖检查点（共 ≥10 项断言）：
1. `voice-outreach.ts` 含 `GET /pending` 路由 + `requireCsAdminOrSuperAdmin` 鉴权
2. `voice-outreach.ts` 含 10min 去重逻辑（`interval '10 min'` 关键字）
3. `20260719_voice_call_records_v2.sql` 含 call_phase / trigger_source / machine_id / transcript 字段
4. `voice_outreach_rules` 表存在（含 condition_expr / dry_run / cooldown_days）
5. `dispatcher.py` 存在且含乐观锁 UPDATE 逻辑
6. `worker.py` 存在且含 start_audio_bridge 调用
7. `rule_engine.py` 存在且含 dry_run 逻辑
8. Python 单元测试三套全通：test_dispatcher / test_worker / test_rule_engine
9. vitest 新测试：GET /pending 返回 queued 记录、POST /call 去重 409、鉴权 requireCsAdminOrSuperAdmin

```
修改文件: apps/api/src/routes/voice-outreach.test.ts
新增分组: GET /pending、POST /call 去重、鉴权变更
```

### 真机段（xian-rog 手动，需截图/日志存档）

```
# E-1 全链路触发（最核心）
curl -X POST http://localhost:3000/api/cs/voice-outreach/call \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"test","contact_name":"默忆","wechat_account":"test","trigger_source":"manual","triggered_by":"user-1"}' | jq .
# 期望: { success: true, data: { call_id, status: "queued" } }
# 然后观察 DB: psql $DATABASE_URL -c "SELECT call_phase FROM voice_call_records ORDER BY called_at DESC LIMIT 1"
# 期望序列: queued → claimed → dialing → in_call → completed

# E-2 接通 + 合规开场 + ASR 转写验证（对方为默忆/小胡同学）
# 期望: 对方能听到"您好，我是徐先生企业自媒体的智能语音助手"
# 通话结束后: psql $DATABASE_URL -c "SELECT status, transcript FROM voice_call_records ORDER BY called_at DESC LIMIT 1"
# 期望: status=answered, transcript 非空

# E-3 并发认领测试（熔断防护）
# 同时发两个 GET /pending?machine_id=m1 和 machine_id=m2 → 只有一个 UPDATE 返回 1 行

# E-4 机器熔断测试（截图留档）
# 手动注入 5 次 <30s 快失败 → 飞书收到告警 + dispatcher 日志显示 circuit_open
```

---

## 四、Invariant 继承确认

以下 Invariant 在本 sprint 代码中必须可验证（smoke 或 vitest 至少一项）：

| Invariant | 验证方式 |
|-----------|---------|
| I-9 call_phase 原子推进 | test_worker: dialing UPDATE 0行立即中止（不调 make_voice_call）|
| I-10 子进程锁文件 | test_dispatcher: 锁文件存在且 PID 活跃时跳过认领 |
| I-11 machine 熔断 | test_dispatcher: 5次<30s快失败 → circuit_open=True |
| I-12 去重双层 | vitest: POST /call 去重409 + test_rule_engine: 3天冷却跳过 |
| I-13 DB 降级 | vitest: GET /pending DB故障 → 200 空列表 |
| I-14 鉴权修复 | smoke: grep requireCsAdminOrSuperAdmin in voice-outreach.ts |

---

## 五、不在本 Sprint 验收范围

- AI 对话接通后中途掉线监听（ai_dropped 仅限连接建立阶段）
- 多机器绑定同一微信号的选择规则
- 平台级并发限流
- 声学回声消除（AEC）
- 多账号矩阵拨号
