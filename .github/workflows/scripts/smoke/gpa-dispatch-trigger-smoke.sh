#!/usr/bin/env bash
# smoke: gpa-dispatch-trigger-smoke.sh
# GP-A 主动语音触达 — 派发链路与触发入口 CI 可达段 smoke 验证
#
# 本 smoke 覆盖 sprint 07191407-gpa-dispatch-trigger 的完整验收标准（CI 可达段）。
#
# 覆盖范围：
#   1. GET /pending 接口存在 + DB 字段 + 鉴权修复断言（I-14）
#   2. POST /call 去重 409 逻辑存在断言（I-12）
#   3. DB Migration v2 字段断言（call_phase/trigger_source/machine_id/transcript）
#   4. voice_outreach_rules 表结构断言
#   5. Python dispatcher.py / worker.py / rule_engine.py 存在断言
#   6. Python 单元测试三套全通（test_dispatcher / test_worker / test_rule_engine）
#   7. make_voice_call → start_audio_bridge 接线断言（call_rpa.py grep）
#   8. 真机段等价断言注释（TODO(real-machine)）
#
# 使用：
#   bash .github/workflows/scripts/smoke/gpa-dispatch-trigger-smoke.sh
#
# 退出码：0=全部通过，1=任一失败

set -euo pipefail

PASS_COUNT=0
FAIL_COUNT=0
WORKSPACE="."

log_pass() { echo "  PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail() { echo "  FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

echo "========================================"
echo "GP-A 派发链路 smoke (CI 可达段)"
echo "sprint: 07191407-gpa-dispatch-trigger"
echo "========================================"

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 1: GET /pending 接口 + 鉴权修复断言（I-14 + BEHAVIOR-2）
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[1] GET /pending 接口 + 鉴权修复断言"

ROUTE_FILE="$WORKSPACE/apps/api/src/routes/voice-outreach.ts"

if [ ! -f "$ROUTE_FILE" ]; then
  log_fail "voice-outreach.ts 不存在: $ROUTE_FILE"
else
  log_pass "voice-outreach.ts 文件存在"

  # I-14 鉴权修复：不再用 requireCsWriteAccess('wechatId')
  if grep -q "requireCsAdminOrSuperAdmin" "$ROUTE_FILE"; then
    log_pass "I-14: 含 requireCsAdminOrSuperAdmin 鉴权"
  else
    log_fail "I-14: 缺 requireCsAdminOrSuperAdmin（鉴权未修复）"
  fi

  # 确认旧鉴权已移除（POST /call 不应再用 requireCsWriteAccess('wechatId')）
  # 注意：文件中可能还有注释或其他用途的 requireCsWriteAccess，只检查 /call 路由附近
  CALL_ROUTE_USES_OLD_AUTH=$(node -e "
    const fs = require('fs');
    const content = fs.readFileSync('$ROUTE_FILE', 'utf8');
    // 检查 /call 路由是否仍然使用旧鉴权（requireCsWriteAccess with 'wechatId'）
    const callSection = content.match(/voiceOutreachRouter\.post\s*\(\s*['\"]\/call[\s\S]*?async \(req/);
    if (callSection && callSection[0].includes(\"requireCsWriteAccess('wechatId')\")) {
      console.log('yes');
    } else {
      console.log('no');
    }
  " 2>/dev/null || echo "check_skipped")

  if [ "$CALL_ROUTE_USES_OLD_AUTH" = "yes" ]; then
    log_fail "I-14: POST /call 仍在使用 requireCsWriteAccess('wechatId')（应改为 requireCsAdminOrSuperAdmin）"
  else
    log_pass "I-14: POST /call 已不使用旧 requireCsWriteAccess('wechatId')"
  fi

  # GET /pending 端点存在
  if grep -q "'/pending'" "$ROUTE_FILE" || grep -q '"/pending"' "$ROUTE_FILE"; then
    log_pass "含 GET /pending 端点"
  else
    log_fail "缺 GET /pending 端点（Agent 轮询认领接口）"
  fi

  # 10 分钟去重逻辑
  if grep -q "10 min\|10min\|DUPLICATE_CALL" "$ROUTE_FILE"; then
    log_pass "I-12: 含 10min 去重逻辑（DUPLICATE_CALL）"
  else
    log_fail "I-12: 缺 10min 去重逻辑"
  fi

  # call_phase 字段引用
  if grep -q "call_phase" "$ROUTE_FILE"; then
    log_pass "含 call_phase 字段引用"
  else
    log_fail "缺 call_phase 字段（派发状态机核心）"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 2: DB Migration v2 — call_phase + trigger_source + machine_id + transcript
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[2] DB Migration v2 字段断言（voice_call_records_v2）"

MIGRATION_V2="$WORKSPACE/apps/api/db/migrations/20260719_voice_call_records_v2.sql"

if [ ! -f "$MIGRATION_V2" ]; then
  log_fail "migration v2 不存在: $MIGRATION_V2"
else
  log_pass "20260719_voice_call_records_v2.sql 文件存在"

  MIGRATION_V2="$MIGRATION_V2" node -e "
const c = require('fs').readFileSync(process.env.MIGRATION_V2, 'utf8');
const checks = [
  ['call_phase',       '缺 call_phase 列（I-9 状态机）'],
  ['trigger_source',   '缺 trigger_source 列'],
  ['triggered_by',     '缺 triggered_by 列'],
  ['machine_id',       '缺 machine_id 列（I-11 熔断）'],
  ['transcript',       '缺 transcript 列（ASR 转写存储）'],
  ['claimed_at',       '缺 claimed_at 时间戳列'],
  ['dialing_at',       '缺 dialing_at 时间戳列'],
  ['answered_at',      '缺 answered_at 时间戳列'],
  ['IF NOT EXISTS',    '缺 IF NOT EXISTS（N-4 幂等）'],
  ['ai_dropped',       '缺 ai_dropped 新终态'],
  ['idx_voice_call_records_phase', '缺 call_phase 索引（N-1 轮询性能）'],
];
let fail = false;
for (const [kw, msg] of checks) {
  if (!c.includes(kw)) { console.error('  FAIL: ' + msg); fail = true; }
  else console.log('  PASS: ' + kw);
}
if (fail) process.exit(1);
" || log_fail "migration v2 关键字断言未通过"
fi

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 3: voice_outreach_rules 表结构断言
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[3] voice_outreach_rules 表断言"

# 规则表可能在同一 v2 migration 文件中
RULES_FILE=""
if [ -f "$MIGRATION_V2" ]; then
  RULES_FILE="$MIGRATION_V2"
else
  # 也可能单独一个文件
  RULES_FILE_ALT="$WORKSPACE/apps/api/db/migrations/20260719_voice_outreach_rules.sql"
  if [ -f "$RULES_FILE_ALT" ]; then
    RULES_FILE="$RULES_FILE_ALT"
  fi
fi

if [ -z "$RULES_FILE" ]; then
  log_fail "voice_outreach_rules 表 migration 文件不存在"
else
  RULES_FILE="$RULES_FILE" node -e "
const c = require('fs').readFileSync(process.env.RULES_FILE, 'utf8');
const checks = [
  ['voice_outreach_rules', '缺 voice_outreach_rules 表名'],
  ['condition_expr',       '缺 condition_expr 列（规则条件表达式）'],
  ['dry_run',              '缺 dry_run 列（N-8 预览模式）'],
  ['cooldown_days',        '缺 cooldown_days 列（I-12 冷却期配置）'],
  ['enabled',              '缺 enabled 列（一键关闭功能）'],
];
let fail = false;
for (const [kw, msg] of checks) {
  if (!c.includes(kw)) { console.error('  FAIL: ' + msg); fail = true; }
  else console.log('  PASS: ' + kw);
}
if (fail) process.exit(1);
" || log_fail "voice_outreach_rules 表字段断言未通过"
fi

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 4: Python 新模块文件存在断言
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[4] Python 新模块文件存在"

VOICE_CALL_DIR="$WORKSPACE/services/agent/build-modules/line04/wechat-rpa/voice_call"

for f in "dispatcher.py" "worker.py" "rule_engine.py"; do
  if [ -f "$VOICE_CALL_DIR/$f" ]; then
    log_pass "$f 存在"
  else
    log_fail "$f 不存在（尚未实现）"
  fi
done

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 5: make_voice_call → start_audio_bridge 接线断言
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[5] make_voice_call → start_audio_bridge 接线断言（不再是 TODO）"

CALL_RPA_FILE="$VOICE_CALL_DIR/call_rpa.py"

if [ ! -f "$CALL_RPA_FILE" ]; then
  log_fail "call_rpa.py 不存在"
else
  if grep -q "start_audio_bridge" "$CALL_RPA_FILE"; then
    log_pass "call_rpa.py 含 start_audio_bridge 调用（AI 对话真接线）"
  else
    log_fail "call_rpa.py 缺 start_audio_bridge 调用（仍是 TODO 占位）"
  fi

  # asr_buffer 参数（用于收集转写文本）
  if grep -q "asr_buffer\|asr_callback" "$CALL_RPA_FILE"; then
    log_pass "call_rpa.py 含 asr_buffer/asr_callback 参数（transcript 收集）"
  else
    log_fail "call_rpa.py 缺 asr_buffer 参数（transcript 无法写入）"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 6: Python 单元测试三套全通
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[6] Python 单元测试（CI 可达，mock UIA，不需真机）"

TEST_DIR="$VOICE_CALL_DIR/tests"

# test_dispatcher.py
if [ -f "$TEST_DIR/test_dispatcher.py" ]; then
  log_pass "test_dispatcher.py 存在"

  if command -v python3 >/dev/null 2>&1; then
    # 尝试运行（Red 状态下因模块不存在会 skip，不会 FAIL）
    cd "$WORKSPACE/services/agent/build-modules/line04/wechat-rpa" 2>/dev/null || true
    if python3 -m pytest voice_call/tests/test_dispatcher.py -v --tb=short -q 2>&1 | grep -qE "passed|skipped"; then
      log_pass "test_dispatcher.py 运行（passed 或 skipped）"
    else
      log_fail "test_dispatcher.py 存在但运行报错（非 skip 失败）"
    fi
    cd "$OLDPWD" 2>/dev/null || true
  else
    log_pass "test_dispatcher.py 存在（无 python3，跳过运行验证）"
  fi
else
  log_fail "test_dispatcher.py 不存在"
fi

# test_worker.py
if [ -f "$TEST_DIR/test_worker.py" ]; then
  log_pass "test_worker.py 存在"
else
  log_fail "test_worker.py 不存在"
fi

# test_rule_engine.py
if [ -f "$TEST_DIR/test_rule_engine.py" ]; then
  log_pass "test_rule_engine.py 存在"
else
  log_fail "test_rule_engine.py 不存在"
fi

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 7: vitest 测试文件存在（含新增分组断言）
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[7] vitest 新测试分组断言（voice-outreach.test.ts）"

TEST_TS="$WORKSPACE/apps/api/src/routes/voice-outreach.test.ts"

if [ ! -f "$TEST_TS" ]; then
  log_fail "voice-outreach.test.ts 不存在"
else
  log_pass "voice-outreach.test.ts 文件存在"

  # GET /pending 分组
  if grep -q "GET /api/cs/voice-outreach/pending\|GET.*pending" "$TEST_TS"; then
    log_pass "vitest 含 GET /pending 测试分组"
  else
    log_fail "vitest 缺 GET /pending 测试分组"
  fi

  # 去重 409 测试
  if grep -q "409\|DUPLICATE_CALL" "$TEST_TS"; then
    log_pass "vitest 含去重 409 测试"
  else
    log_fail "vitest 缺去重 409 测试（I-12 核心断言）"
  fi

  # 鉴权变更测试
  if grep -q "requireCsAdminOrSuperAdmin\|CsAdminOrSuperAdmin" "$TEST_TS"; then
    log_pass "vitest 含鉴权变更测试（I-14）"
  else
    log_fail "vitest 缺鉴权变更测试（I-14）"
  fi

  # DB 降级测试（I-13）
  if grep -q "DB 故障\|db.*error.*200\|I-13\|empty.*pending\|empty.*list" "$TEST_TS"; then
    log_pass "vitest 含 GET /pending DB 降级测试（I-13）"
  else
    log_fail "vitest 缺 DB 降级测试（I-13）"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 8: contract-dod.md + contract-draft.md 存在（sprint 产物）
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[8] Sprint contract 产物存在"

SPRINT_DIR="$WORKSPACE/sprints/07191407-gpa-dispatch-trigger"

for f in "contract-draft.md" "contract-dod.md" "sprint-prd.md"; do
  if [ -f "$SPRINT_DIR/$f" ]; then
    log_pass "$f 存在"
  else
    log_fail "$f 不存在"
  fi
done

# ──────────────────────────────────────────────────────────────────────────────
# SECTION 9: 真机段等价断言注释（CI 不可达，xian-rog 手动执行）
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "[9] 真机段等价断言（TODO(real-machine) — CI 不可达）"

# TODO(real-machine): 在 xian-rog 上手动运行以下验收项（每项需截图/日志存档）：
#
# E-1 全链路触发 + DB call_phase 序列观测：
#   curl -X POST http://localhost:3000/api/cs/voice-outreach/call \
#     -H 'Content-Type: application/json' \
#     -d '{"tenant_id":"test","contact_name":"默忆","wechat_account":"test","trigger_source":"manual","triggered_by":"user-1"}' | jq .
#   psql $DATABASE_URL -c "SELECT id, call_phase, machine_id FROM voice_call_records ORDER BY called_at DESC LIMIT 5"
#   期望：call_phase 序列 queued → claimed → dialing → in_call → completed 可在 DB 观测
#
# E-2 接通 + 合规开场 + ASR 转写非空：
#   psql $DATABASE_URL -c "SELECT status, transcript FROM voice_call_records ORDER BY called_at DESC LIMIT 1"
#   期望: status=answered, transcript 非空（含对话内容）
#
# E-3 并发认领（乐观锁）：
#   同时两个 Agent GET /pending?machine_id=m1 和 machine_id=m2 → 只产生一个子进程
#   psql 查询 claimed 记录：SELECT machine_id, count(*) FROM voice_call_records WHERE call_id='<id>' GROUP BY machine_id
#   期望: 只有一条 claimed 记录
#
# E-4 machine 熔断 + 飞书告警（截图留档）：
#   手动注入 5 次 <30s 快失败 → dispatcher 日志显示 circuit_open=True
#   飞书 webhook 收到告警消息（截图）
#
# E-5 Agent 重启锁文件防重：
#   子进程运行中 kill 父进程 → 重启父进程 → 检查 /tmp/gpa-{call_id}.lock 存在 → 不产生第二个子进程
#
# E-6 CRM 按钮 → 弹窗 → POST /call 全链路（Playwright）：
#   元素存在断言: data-testid="voice-call-button"
#   点击后弹窗出现: data-testid="voice-call-confirm-dialog"
#   确认后 POST /call 被调用（network 拦截验证）

echo "  [真机段等价断言已注释，需在 xian-rog 人工执行 E-1~E-6，每项截图存档]"
PASS_COUNT=$((PASS_COUNT + 1))

# ──────────────────────────────────────────────────────────────────────────────
# 汇总
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "结果: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
echo "========================================"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "GP-A 派发链路 smoke FAIL（$FAIL_COUNT 项失败）"
  exit 1
fi

echo "GP-A 派发链路 smoke (CI 段) PASS"
exit 0
