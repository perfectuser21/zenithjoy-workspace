---
skeleton: false
journey_type: autonomous
target_environment: windows_wechat
---
# Contract DoD — Sprint: DesktopLeaseBroker 第一刀（Line04 Path4-Step5）

**范围**: DesktopLeaseBroker 状态机 + wechat-rpa.ts IPC 转发 + listen_chat.py acquire/release 集成
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/desktop-lease-broker.ts` 新建，导出 `DesktopLeaseBroker` 类
  Test: node -e "require('fs').accessSync('services/agent/src/desktop-lease-broker.ts');const c=require('fs').readFileSync('services/agent/src/desktop-lease-broker.ts','utf8');if(!c.includes('DesktopLeaseBroker'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/desktop-lease-broker.ts` 含 TTL 看门狗（setInterval）逻辑
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/desktop-lease-broker.ts','utf8');if(!c.includes('setInterval')&&!c.includes('watchdog'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/wechat-rpa.ts` 注册 HTTP 路由 `POST /api/agent/desktop-lease-broker/e2e-watchdog-probe`，返回 `{ok:true, lease_id}`（对应 Risks R1）
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/wechat-rpa.ts','utf8');if(!c.includes('e2e-watchdog-probe'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/wechat-rpa.ts` 含 `desktop_lease_*` IPC 转发代码
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/wechat-rpa.ts','utf8');if(!c.includes('desktop_lease_acquire')||!c.includes('desktop_lease_release'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/agent/wechat-rpa/listen_chat.py` 在 `_set_foreground_window` / `_open_chat` 前后有 acquire/release 调用
  Test: python3 -c "c=open('services/agent/wechat-rpa/listen_chat.py').read();assert 'desktop_lease' in c and 'acquire' in c and 'release' in c,'missing lease calls';print('OK')"

- [ ] [ARTIFACT] `sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts` 存在且含 acquire/watchdog 测试
  Test: node -e "const c=require('fs').readFileSync('sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts','utf8');if(!c.includes('acquire')&&!c.includes('watchdog'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

### B1 — Broker acquire 空闲状态返回 granted:true

- [ ] [BEHAVIOR] Broker acquire 空闲状态 → granted:true，lease_id 非空，expires_at > now
  Test: manual:bash -c 'cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);passed=[t for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"passed\"];failing=[t for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"failed\"];names=[t[\"fullName\"] for t in passed];assert any(\"acquire\" in n and \"granted\" in n for n in names),\"FAIL: acquire granted 测试未找到或未通过\";assert not failing,f\"FAIL: {[t[\"fullName\"] for t in failing]}\";print(\"OK acquire granted test passed\")"'
  期望: OK acquire granted test passed

### B2 — Broker TTL 超期后看门狗自动释放 lease（逻辑断言）

- [ ] [BEHAVIOR] Broker TTL 超期 → 看门狗 ≤15s 自动释放，currentLease 变 null
  Test: manual:bash -c 'cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);passed=[t[\"fullName\"] for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"passed\"];assert any(\"watchdog\" in n or \"TTL\" in n for n in passed),\"FAIL: watchdog/TTL 测试未通过 passed=\"+str(passed);print(\"OK watchdog test passed\")"'
  期望: OK watchdog test passed

### B3 — 非持有方 renew 返回 not_owner

- [ ] [BEHAVIOR] 非持有方发 desktop_lease_renew → {ok:false, reason:"not_owner"}
  Test: manual:bash -c 'cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);passed=[t[\"fullName\"] for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"passed\"];assert any(\"not_owner\" in n for n in passed),\"FAIL: not_owner 测试未通过 passed=\"+str(passed);print(\"OK not_owner test passed\")"'
  期望: OK not_owner test passed

### B4 — 低优先级 acquire 在持有中返回 granted:false（防假成功 invariant）

- [ ] [BEHAVIOR] 低优先级（priority=50）在高优先级（priority=0）持有时 → {granted:false, retry_after_ms>0}
  Test: manual:bash -c 'cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);passed=[t[\"fullName\"] for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"passed\"];assert any((\"低优先级\" in n or \"granted\" in n and \"false\" in n) for n in passed),\"FAIL: granted:false 低优先级测试未通过 passed=\"+str(passed);print(\"OK low-priority acquire test passed\")"'
  期望: OK low-priority acquire test passed

### B5 — 重复 release 幂等（接口稳定性）

- [ ] [BEHAVIOR] 重复 release 同一 lease_id → 两次均返回 {ok:true}，不抛异常
  Test: manual:bash -c 'cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);passed=[t[\"fullName\"] for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"passed\"];assert any(\"幂等\" in n or \"idempotent\" in n for n in passed),\"FAIL: release 幂等测试未通过 passed=\"+str(passed);print(\"OK idempotent release test passed\")"'
  期望: OK idempotent release test passed

### B8 — 高优先级抢占（preemption — PRD Golden Path #2 覆盖）

- [ ] [BEHAVIOR] priority=50 持有时 priority=10 到来 → onYield 被调用 + ≤2200ms 强制授予 granted:true
  Test: manual:bash -c 'cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);passed=[t[\"fullName\"] for s in d[\"testResults\"] for t in s[\"testResults\"] if t[\"status\"]==\"passed\"];assert any((\"高优先级抢占\" in n or \"preemption\" in n) for n in passed),\"FAIL: preemption 测试未通过 passed=\"+str(passed);print(\"OK preemption test passed\")"'
  期望: OK preemption test passed

---

### B6 — listen_chat dryrun IPC 集成（接缝断言，xian-rog 真验）

> **接缝 1 断言**（真机验证才算 done；未真验标 `logic-done-pending`）

- [ ] [BEHAVIOR] listen_chat.py --dryrun --inject-message → stderr 含 [desktop_lease] acquire granted + [desktop_lease] release，不含 acquire failed
  Test: manual:bash -c 'AGENT_DIR="${AGENT_DIR:-$LOCALAPPDATA/zenithjoy-agent}"; PYTHON="$AGENT_DIR/python-embedded/python.exe"; SCRIPT="$AGENT_DIR/wechat-rpa/listen_chat.py"; STDERR_OUT=$("$PYTHON" "$SCRIPT" --dryrun --inject-message '"'"'{"sender":"E2E测试客户","wechat_id":"wxid_e2etest","content":"测试"}'"'"' 2>&1 1>/dev/null) || true; echo "$STDERR_OUT" | grep -q "\[desktop_lease\] acquire granted" || { echo "FAIL: 缺 acquire granted"; exit 1; }; echo "$STDERR_OUT" | grep -q "\[desktop_lease\] release" || { echo "FAIL: 缺 release"; exit 1; }; echo "$STDERR_OUT" | grep -q "\[desktop_lease\] acquire failed" && { echo "FAIL: 出现 acquire failed"; exit 1; } || true; echo OK'
  期望: OK
  接缝: 真机 xian-rog 验证（agent core 已启动）

### B7 — 看门狗 Brain log 写入（接缝断言 + DB 时间窗口，xian-rog 真验）

> **接缝 2 断言**（需 Brain 在线 + xian-rog；未真验标 `logic-done-pending`）

- [ ] [BEHAVIOR] watchdog probe 触发后 ≤10s Brain log 出现 desktop_lease_watchdog_triggered（tenant_id 非空 + 3min 时间窗）
  Test: manual:bash -c 'BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; curl -sf "$BRAIN_URL/api/brain/health" | jq -e ".ok == true" || { echo "FAIL: Brain API 不可达"; exit 1; }; PROBE=$(curl -sf -X POST "$BRAIN_URL/api/agent/desktop-lease-broker/e2e-watchdog-probe" -H "Content-Type: application/json" -d '"'"'{"ttl_ms":2000}'"'"'); echo "$PROBE" | jq -e ".ok == true" || { echo "FAIL: probe ok=false resp=$PROBE"; exit 1; }; sleep 10; COUNT=$(PGPASSWORD="$PGPASSWORD" psql -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" -d "${DB_NAME:-cecelia}" -t -c "SELECT count(*) FROM zenithjoy.agent_events WHERE module='"'"'desktop_lease'"'"' AND message='"'"'desktop_lease_watchdog_triggered'"'"' AND context->>'"'"'tenant_id'"'"' IS NOT NULL AND created_at > NOW() - interval '"'"'3 minutes'"'"'" 2>/dev/null | tr -d " "); [ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: Brain log 无 watchdog_triggered（tenant_id 非空，time window 3min）count=${COUNT:-0}"; exit 1; }; echo "OK count=$COUNT"'
  期望: OK count=<N≥1>
  接缝: 真机 xian-rog 验证（Brain API 在线，e2e-watchdog-probe 端点已实现）

---

## 接缝清单（seam list）

| 接缝 | 状态 | 真目标验证方式 |
|---|---|---|
| 接缝 1: listen_chat IPC → Broker acquire/release | `logic-done-pending` → 真验后改 done | B6 命令，xian-rog，agent core 已启动 |
| 接缝 2: Broker watchdog → zenithjoy.agent_events | `logic-done-pending` → 真验后改 done | B7 命令，xian-rog，Brain API 在线，psql 3min 时间窗 |

---

## 测试文件索引

| 文件 | 语言 | 覆盖场景 |
|---|---|---|
| `sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts` | TypeScript (vitest) | Broker 状态机：acquire/renew/release/watchdog/优先级/幂等（逻辑断言）|
| `services/agent/wechat-rpa/tests/test_listen_chat_lease.py` | Python (pytest) | listen_chat dryrun IPC 集成（Generator 实现后补充）|
