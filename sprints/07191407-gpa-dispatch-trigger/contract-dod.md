# Contract DoD — GP-A 主动语音触达：派发链路与触发入口

task_id: 2ac0e77b-c2e3-47e9-92dd-7549622835d7
sprint_dir: sprints/07191407-gpa-dispatch-trigger
生成时间: 2026-07-19

---

## BEHAVIOR 条目（≥4 条，含 manual:bash 验收命令）

### [BEHAVIOR-1] POST /call 鉴权修复 + 去重 409

**描述**：鉴权从 requireCsWriteAccess('wechatId')（依赖 :wechatId 路径参数，导致 404 死链）改为 requireCsAdminOrSuperAdmin。同一 tenant_id+contact_name+wechat_account 10分钟内第二次请求返回 409 DUPLICATE_CALL。

**验收命令（manual:bash）**：
```bash
# 前置：API 服务运行在 localhost:3000，DB 已跑 v2 migration
# 场景1：鉴权修复验证（admin token 可访问，不走 :wechatId 参数）
curl -s -X POST http://localhost:3000/api/cs/voice-outreach/call \
  -H 'Content-Type: application/json' \
  -H 'x-tenant-id: test-tenant' \
  -d '{"tenant_id":"test-tenant","contact_name":"默忆","wechat_account":"wx-001","trigger_source":"manual","triggered_by":"user-1"}' | jq .
# 期望: { "success": true, "data": { "call_id": "<uuid>", "status": "queued" } }

# 场景2：10分钟去重（立即重发同一请求）
curl -s -X POST http://localhost:3000/api/cs/voice-outreach/call \
  -H 'Content-Type: application/json' \
  -H 'x-tenant-id: test-tenant' \
  -d '{"tenant_id":"test-tenant","contact_name":"默忆","wechat_account":"wx-001","trigger_source":"manual","triggered_by":"user-1"}' | jq .
# 期望: { "success": false, "error": { "code": "DUPLICATE_CALL" } }  HTTP 409
```

**CI 覆盖**：vitest `POST /call 去重 409` + smoke 节点1（鉴权 grep）

---

### [BEHAVIOR-2] GET /pending 乐观锁认领（Agent 派发核心）

**描述**：GET /api/cs/voice-outreach/pending?machine_id=<id>&limit=1 返回 call_phase='queued' 的任务列表。DB 故障时返回 200 空列表（I-13 降级），不抛 500。乐观锁 UPDATE 返回 0 行时 Agent 静默跳过（不写 INFO 日志）。

**验收命令（manual:bash）**：
```bash
# 场景1：正常认领
# 先插入一条 queued 记录
psql "$DATABASE_URL" -c "
  INSERT INTO voice_call_records (id, tenant_id, contact_name, wechat_account, call_phase, called_at, call_id)
  VALUES (gen_random_uuid(), 'test-tenant', '默忆', 'wx-001', 'queued', NOW(), gen_random_uuid());
"
# 查询 pending
curl -s "http://localhost:3000/api/cs/voice-outreach/pending?machine_id=machine-1&limit=1" \
  -H 'x-tenant-id: test-tenant' | jq .
# 期望: { "success": true, "data": [{ "call_id": "<uuid>", "call_phase": "queued", "contact_name": "默忆" }] }

# 场景2：DB 故障降级（模拟：临时断开 PG 或 mock）
# 期望 HTTP 200, data: []（而非 500）

# 场景3：乐观锁（并发两个 machine 同时认领同一条记录）
# 期望：只有一个收到 RETURNING id，另一个跳过
```

**CI 覆盖**：vitest `GET /pending` 三个子用例（正常/降级/乐观锁0行）

---

### [BEHAVIOR-3] call_phase 原子推进（防重复拨打 I-9）

**描述**：子进程（worker.py）入口第一步执行 `UPDATE ... WHERE call_phase='claimed' AND machine_id=$2 RETURNING id`。返回 0 行时立即退出，不调用 make_voice_call()。确保同一 call_id 在一台机器上最多被拨打一次。

**验收命令（manual:bash）**：
```bash
# CI 可达：Python 单元测试（不需真机）
cd /workspace/services/agent/build-modules/line04/wechat-rpa
python -m pytest voice_call/tests/test_worker.py::TestWorkerAtomicPhase -v
# 期望: test_dialing_update_zero_rows_aborts PASSED（make_voice_call 未被调用）

# 真机段等价断言（xian-rog）：
# 1. psql 手动将某条记录改为 call_phase='completed'（模拟已被另一机器认领完成）
# 2. 启动 worker.py 尝试认领 → 应立即退出，日志显示 "0 rows returned, aborting"
# 3. psql 确认该记录 call_phase 未从 completed 变回 dialing
psql "$DATABASE_URL" -c "SELECT call_phase FROM voice_call_records WHERE call_id='<call-id>';"
# 期望: completed（未被修改）
```

**CI 覆盖**：test_worker.py TestWorkerAtomicPhase（4 个子用例）

---

### [BEHAVIOR-4] machine 级熔断（I-11，OverlayWatchdog 模式）

**描述**：dispatcher.py 在 60分钟窗口内连续 5 次「认领后 <30s 秒级失败」后触发熔断：停止 GET /pending 轮询 + 发飞书告警（FEISHU_ALERT_WEBHOOK）。agent 重启复位熔断状态。

**验收命令（manual:bash）**：
```bash
# CI 可达：Python 单元测试
cd /workspace/services/agent/build-modules/line04/wechat-rpa
python -m pytest voice_call/tests/test_dispatcher.py::TestCircuitBreaker -v
# 期望:
#   test_5_fast_failures_trigger_circuit_open PASSED
#   test_circuit_open_stops_polling PASSED
#   test_feishu_alert_sent_on_circuit_open PASSED

# 真机段（xian-rog，截图留档）：
# 1. 手动注入 5 次 <30s 快失败（修改 worker 模拟快速 FAIL）
# 2. 观察 dispatcher 日志: "circuit_open=True, stopping poll"
# 3. 飞书收到告警消息（截图）
# 4. kill dispatcher + 重启 → 熔断复位，恢复轮询
```

**CI 覆盖**：test_dispatcher.py TestCircuitBreaker（3 个子用例）

---

### [BEHAVIOR-5] 自动规则引擎 dry-run + 3天冷却期（I-12）

**描述**：rule_engine.py 每 15 分钟扫描 voice_outreach_rules。dry_run=True 时只发飞书通知，不写 voice_call_records。3天冷却期：no_answer 终态后该联系人 3 天内被 rule_engine 自动跳过（条件：`called_at > NOW() - interval '3 days'` filter）。

**验收命令（manual:bash）**：
```bash
# CI 可达
cd /workspace/services/agent/build-modules/line04/wechat-rpa
python -m pytest voice_call/tests/test_rule_engine.py -v
# 期望:
#   test_dry_run_sends_feishu_no_call_records PASSED
#   test_3day_cooldown_skips_contact PASSED
#   test_10min_dedup_window_skips_contact PASSED
#   test_disabled_rule_not_executed PASSED
```

**CI 覆盖**：test_rule_engine.py（4 个子用例）

---

### [BEHAVIOR-6] 通话记录展示（CRM 列表 + 标签页 + ASR 转写）

**描述**：CustomerListPage 新增「最近通话」列（answered=接通/no_answer=未接/failed=失败/null=—）。CustomerProfilePage 新增「通话记录」标签页，展示时间/时长/接通状态/触发方式/ASR 转写全文（可折叠）。GET /records 响应含 transcript 字段。

**验收命令（manual:bash）**：
```bash
# API 层验证（CI 可达）
curl -s "http://localhost:3000/api/cs/voice-outreach/records?tenant_id=test-tenant&contact_name=默忆" \
  -H 'x-tenant-id: test-tenant' | jq '.data[0] | {call_phase, transcript, trigger_source, triggered_by}'
# 期望: 含上述字段（非 undefined）

# Dashboard 层验证（Playwright，CI windows-latest runner）
# 期望: CustomerProfilePage 有「通话记录」标签页（data-testid="voice-calls-tab"）
# 点击后展示通话列表（data-testid="voice-call-record-item"）
# CustomerListPage 最近通话列（data-testid="recent-call-status"）
```

**CI 覆盖**：vitest GET /records 字段断言 + Playwright E2E（dashboard spec）

---

## DoD 完成标准

### 必须全绿才能合并

- [ ] `gpa-dispatch-trigger-smoke.sh` 全绿（新文件，≥10 项断言）
- [ ] `voice-outreach.test.ts` vitest 全绿（包括新增的 GET /pending、去重 409、鉴权变更分组）
- [ ] `test_dispatcher.py` 全绿（乐观锁/锁文件/熔断/DB降级）
- [ ] `test_worker.py` 全绿（dialing原子/contact_mismatch/指数退避/落盘兜底）
- [ ] `test_rule_engine.py` 全绿（dry-run/3天冷却/10min去重/disabled跳过）
- [ ] 原有 `gpa-voice-outreach-smoke.sh` 保持全绿（回流 call_phase 判据）

### 真机验收（PR 合并后在 xian-rog 完成，存截图/日志）

- [ ] E-1 POST /call → DB call_phase 序列 queued→claimed→dialing→in_call→completed 可观测
- [ ] E-2 接通后 ASR 转写非空（psql 验证 transcript 字段）
- [ ] E-3 并发认领只产生一个子进程（锁文件验证）
- [ ] E-4 熔断触发 + 飞书告警截图
- [ ] E-5 Agent 重启锁文件防重验证
- [ ] E-6 CRM 呼叫按钮 → 弹窗 → POST /call 全链路（Playwright 等价断言）
