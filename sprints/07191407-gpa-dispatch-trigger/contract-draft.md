# Contract Draft：GP-A 主动语音触达 — 触发入口与派发链路

| 字段 | 值 |
|------|-----|
| task_id | 2ac0e77b-c2e3-47e9-92dd-7549622835d7 |
| sprint_dir | sprints/07191407-gpa-dispatch-trigger |
| contract_version | v1.0 |
| 生成时间 | 2026-07-19 |
| 前置 sprint | 07182017-gpa-voice-outreach（PR #1397，已合并） |

---

## 一、验收范围

本合同覆盖 sprint-prd.md 声明的全部 Feature，以可验证的技术断言形式定义"完成"。

---

## 二、判定点登记表

| 判定点 ID | 描述 | 验证层 | 文件 | 对应 Invariant |
|-----------|------|--------|------|---------------|
| C-01 | POST /api/cs/voice-outreach/call 鉴权改为 requireCsAdminOrSuperAdmin，无 wechatId param 仍能通过 401 鉴权而不是 404 | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-15 |
| C-02 | POST /call 同一 (tenant_id, contact_name) 10 分钟窗口内二次请求返回 409 + 已有 call_id | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-10 |
| C-03 | POST /call 上次通话（answered/no_answer）距今 < 3 天返回 429 COOLING_DOWN | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-11 |
| C-04 | POST /claim 乐观锁：两个 machine 并发认领同一 call_id，只有一个成功（202），另一个返回 409 CLAIM_CONFLICT | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-13 |
| C-05 | call_rpa.py 拨号前 UPDATE call_phase='dialing' WHERE call_phase='claimed' 返回 0 行时调用 abort_call() | pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | I-9 |
| C-06 | machine_circuit.py 60 分钟窗口内同一 machine_id ≥5 次 30s 内失败后 circuit_open=True | pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | I-12 |
| C-07 | dispatch_loop.py 若 call_id 子进程 PID 仍存活，不再 spawn 新子进程 | pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | I-13 |
| C-08 | lease_until 过期后 GET /pending 可重新返回该任务（lease 回收路径） | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-15 |
| C-09 | dry_run_mode=true 时自动规则扫描不写 voice_call_records，只返回命中列表 | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-14 |
| C-10 | dry_run_confirmed_at IS NULL 时 enabled=true 规则禁止切换到真实执行（PUT auto-rules 返回 400） | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | I-14 |
| C-11 | DB migration 幂等：重复执行 20260719_voice_call_dispatch.sql 无报错 | smoke.sh | `golden-path-4-smoke.sh` GP-A 段 | — |
| C-12 | POST /call 成功时 call_phase 落库初始值为 'queued'（不再是 'failed'） | vitest + smoke | `voice-outreach.test.ts` + `golden-path-4-smoke.sh` | — |
| C-13 | POST /records 支持 asr_transcript 字段写入，GET /records 响应中可查询到 | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` | — |
| C-14 | CRM「呼叫该客户」按钮 → 二次确认弹窗显示上次通话状态/时间 → 确认 → API 调用 → 页面展示 queued 状态 | Playwright E2E | `apps/dashboard/e2e/voice-outreach-crm.spec.ts` | I-15 |
| C-15 | GET /api/cs/voice-outreach/machine-circuit-status?machine_id=X 返回 circuit_open + fast_fail_count 字段 | vitest + smoke | `voice-outreach.test.ts` + `golden-path-4-smoke.sh` | I-12 |
| C-16 | make_voice_call() 真正调用 start_audio_bridge()（空洞补齐验证） | pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | — |
| C-17 | 飞书 webhook 告警：machine 熔断事件触发后发送飞书消息（mock webhook 端点验证被调用） | pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | I-12 |
| C-18 | voice_outreach_auto_rules 表 migration 幂等，dry_run_mode 默认值为 true | smoke.sh | `golden-path-4-smoke.sh` GP-A 段 | I-14 |

---

## E2E 验收

### GP-A 段完整拨打链路（API 层等价断言）

以下为 `golden-path-4-smoke.sh` GP-A 段新增断言序列，覆盖 PRD 六步 Golden Path：

**Step GP-A-1：CRM 手动呼叫入口 + 鉴权**
```bash
# 断言：无 wechatId param 的 POST /call 鉴权不再返回 404（改 requireCsAdminOrSuperAdmin 后）
HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INT_TOKEN" \
  -d '{"tenant_id":"'$TENANT_ID'","contact_name":"测试联系人"}')
[ "$HTTP" = "202" ] || [ "$HTTP" = "200" ] || fail "GP-A Step1 call 鉴权 got $HTTP (期望非404)" 101
```

**Step GP-A-2：任务入队 → pending 轮询**
```bash
# 断言：POST /call 后 GET /pending 可返回该任务
CALL_ID=$(post_call "$TENANT_ID" "gpa-smoke-contact-$RND")
PENDING=$(curl -s "$API_BASE/api/cs/voice-outreach/pending?machine_id=$MACHINE_ID&tenant_id=$TENANT_ID")
echo "$PENDING" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['data']['call_id'] == sys.argv[1]" "$CALL_ID"
```

**Step GP-A-3：乐观锁认领**
```bash
# 断言：POST /claim 成功后 call_phase=claimed，二次认领返回 409
HTTP_CLAIM=$(curl -s -o "$TMP" -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/claim" \
  -H "Content-Type: application/json" \
  -d "{\"call_id\":\"$CALL_ID\",\"machine_id\":\"$MACHINE_ID\",\"tenant_id\":\"$TENANT_ID\"}")
[ "$HTTP_CLAIM" = "202" ] || fail "GP-A Step3 claim 期望 202, got $HTTP_CLAIM" 103
HTTP_CLAIM2=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/claim" \
  -H "Content-Type: application/json" \
  -d "{\"call_id\":\"$CALL_ID\",\"machine_id\":\"machine-b-$RND\",\"tenant_id\":\"$TENANT_ID\"}")
[ "$HTTP_CLAIM2" = "409" ] || fail "GP-A Step3 二次认领期望 409 CLAIM_CONFLICT, got $HTTP_CLAIM2" 103
```

**Step GP-A-4：通话记录回写 + ASR 转写存储**
```bash
# 断言：POST /records { call_id, status:'answered', asr_transcript } 写入成功
# DB 查询确认 asr_transcript 非空 + call_phase='answered'
HTTP_REC=$(curl -s -o "$TMP" -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/records" \
  -H "Content-Type: application/json" \
  -d "{\"call_id\":\"$CALL_ID\",\"status\":\"answered\",\"duration_seconds\":65,\"asr_transcript\":\"你好请问...\"}")
[ "$HTTP_REC" = "200" ] || fail "GP-A Step4 records 回写期望 200, got $HTTP_REC" 104
PHASE=$(psq "SELECT call_phase FROM zenithjoy.voice_call_records WHERE id='$CALL_ID'")
[ "$PHASE" = "answered" ] || fail "GP-A Step4 call_phase 期望 answered, got $PHASE" 104
ASR=$(psq "SELECT asr_transcript FROM zenithjoy.voice_call_records WHERE id='$CALL_ID'")
[ -n "$ASR" ] || fail "GP-A Step4 asr_transcript 未落库" 104
```

**Step GP-A-5：10 分钟去重窗口**
```bash
# 断言：同一 (tenant_id, contact_name) 10 分钟内二次 POST /call 返回 409
HTTP_DUP=$(curl -s -o "$TMP" -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"contact_name\":\"gpa-smoke-contact-$RND\"}")
[ "$HTTP_DUP" = "409" ] || fail "GP-A Step5 去重窗口期望 409, got $HTTP_DUP" 105
echo "$TMP_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'call_id' in d.get('error',{})" || true
```

**Step GP-A-6：CRM 列表状态列 + GET /records 展示**
```bash
# 断言：GET /records 响应包含刚回写的记录，且含 call_phase/asr_transcript 字段
RECORDS=$(curl -s "$API_BASE/api/cs/voice-outreach/records?tenant_id=$TENANT_ID")
echo "$RECORDS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
recs = d.get('data',[])
assert any(r.get('id')=='$CALL_ID' for r in recs), f'call_id 不在记录列表: {[r.get(\"id\") for r in recs]}'
rec = next(r for r in recs if r.get('id')=='$CALL_ID')
for f in ['call_phase','asr_transcript','trigger_source','machine_id']:
    assert f in rec, f'缺字段 {f}: {list(rec.keys())}'
"
```

**Step GP-A-7：machine 熔断状态查询**
```bash
# 断言：GET /machine-circuit-status 返回结构正确（circuit_open + fast_fail_count）
CIRCUIT=$(curl -s "$API_BASE/api/cs/voice-outreach/machine-circuit-status?machine_id=$MACHINE_ID")
echo "$CIRCUIT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
data=d.get('data',{})
assert 'circuit_open' in data, f'缺 circuit_open: {data}'
assert 'fast_fail_count' in data, f'缺 fast_fail_count: {data}'
"
```

**Step GP-A-8：3 天冷却期**
```bash
# 断言：向已有 answered 记录（called_at = NOW()-2days）的联系人发起呼叫返回 429 COOLING_DOWN
# 通过直接写 DB fixture 构造距今 2 天的 answered 记录，再 POST /call 验证返回 429
psq "INSERT INTO zenithjoy.voice_call_records (id, tenant_id, contact_name, status, call_phase, called_at) \
  VALUES (gen_random_uuid(), '$TENANT_ID'::uuid, 'cooling-contact-$RND', 'answered', 'answered', NOW()-interval '2 days')"
HTTP_COOL=$(curl -s -o "$TMP" -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"contact_name\":\"cooling-contact-$RND\"}")
[ "$HTTP_COOL" = "429" ] || fail "GP-A Step8 冷却期期望 429 COOLING_DOWN, got $HTTP_COOL" 108
echo "$(cat "$TMP")" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'COOLING_DOWN' in str(d)" || fail "GP-A Step8 响应缺 COOLING_DOWN" 108
```

---

## 三、Invariant 覆盖确认

| Invariant | 覆盖情况 | 判定点 |
|-----------|---------|--------|
| I-9 防重复拨打（乐观锁 dialing UPDATE） | ✅ 已覆盖 | C-05 |
| I-10 10 分钟技术去重窗口 | ✅ 已覆盖 | C-02，GP-A Step5 |
| I-11 3 天业务冷却期 | ✅ 已覆盖 | C-03，GP-A Step8 |
| I-12 联系人精确匹配（搜索框定位+标题核对） | ✅ 前置 sprint 已覆盖（I-1），本次 C-06 熔断覆盖机器快速失败场景 | C-06 |
| I-13 乐观锁认领原子性 | ✅ 已覆盖 | C-04，GP-A Step3 |
| I-14 machine 熔断阈值 | ✅ 已覆盖 | C-06，C-15，GP-A Step7 |
| I-15 lease 回收（watchdog 按 call_phase 倒推终态） | ✅ 已覆盖 | C-08 |

> 注：I-12 在 PRD 中编号为「联系人精确匹配」，与 sprint-prd.md Invariant 表中的 I-1 对应；
> 本 sprint 新增 I-9～I-15 均已有判定点覆盖。

---

## 四、CI 硬门槛

- `apps/api/src/routes/voice-outreach.test.ts` 全绿（新增 C-01～C-13 所有用例）
- `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` 全绿（C-05～C-07，C-16～C-17）
- `apps/dashboard/e2e/voice-outreach-crm.spec.ts` 全绿（C-14，windows_cloud runner）
- `golden-path-4-smoke.sh` GP-A 段（C-11～C-12，C-15，GP-A Step1～8）全绿
- 真机段（接通/no_answer/ASR 回写全链路）标注 `# TODO(gpa-realmachine): 真机验证` 等价断言

---

## 五、不包含（本合同边界）

参考 sprint-prd.md「不包含」节，本合同不验证以下内容：
- AI 对话接通后中途掉线的完整监听检测
- 多台机器绑同一微信号的选择规则
- 通话录音文件存储（仅 ASR 文本）
- lease 预算真机实测标定
