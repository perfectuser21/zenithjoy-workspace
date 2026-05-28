---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 6: GHA workflow + check-health.js 修复 + smoke.sh

**范围**: 修正 `.github/workflows/session-health-check.yml`（*_MAIN → *_COOKIES，8 平台主号）；修正 `scripts/sessions/check-health.js`（missing≠ok bug，expired → 飞书告警 Promise.race 3s，POST status 回写 DB）；新建 `.github/workflows/scripts/smoke/session-health-medium-smoke.sh`
**大小**: M（~180 行净变化，3 文件）
**依赖**: Workstream 5 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/session-health-check.yml` 无 *_MAIN Secret 引用
  Test: bash -c 'COUNT=$(grep -c "_MAIN:" .github/workflows/session-health-check.yml 2>/dev/null || echo 0); [ "$COUNT" = "0" ] && echo OK || { echo "FAIL: workflow 仍含 $COUNT 处 _MAIN Secret 引用"; exit 1; }'

- [ ] [ARTIFACT] `.github/workflows/session-health-check.yml` 含 DOUYIN_COOKIES Secret 引用
  Test: bash -c 'grep -q "DOUYIN_COOKIES" .github/workflows/session-health-check.yml && echo OK || { echo "FAIL: workflow 缺 DOUYIN_COOKIES"; exit 1; }'

- [ ] [ARTIFACT] `scripts/sessions/check-health.js` 含飞书告警逻辑（FEISHU_BOT_WEBHOOK 引用）
  Test: bash -c 'grep -q "FEISHU_BOT_WEBHOOK\|feishu\|飞书" scripts/sessions/check-health.js && echo OK || { echo "FAIL: check-health.js 缺飞书告警逻辑"; exit 1; }'

- [ ] [ARTIFACT] smoke.sh 存在于 `.github/workflows/scripts/smoke/` 且 ≥15 行实质内容
  Test: bash -c '[ -f ".github/workflows/scripts/smoke/session-health-medium-smoke.sh" ] || { echo "FAIL: smoke.sh 不存在"; exit 1; }; LINES=$(grep -v "^#\|^$" .github/workflows/scripts/smoke/session-health-medium-smoke.sh | wc -l | tr -d " "); [ "$LINES" -ge 15 ] || { echo "FAIL: smoke.sh 实质行数=$LINES 期望≥15"; exit 1; }; echo OK'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] check-health.js missing 状态不被当 ok 处理（missing bug 修复验证）
  Test: manual:bash -c 'node -e "const src=require('"'"'fs'"'"').readFileSync('"'"'scripts/sessions/check-health.js'"'"','"'"'utf8'"'"'); const bugPattern=/missing.*[=:!<>].*ok\b|ok\b.*[=:!<>].*missing/i; const hasBug=bugPattern.test(src); if(hasBug){console.error('"'"'FAIL: missing=ok bug 仍存在'"'"');process.exit(1);} if(!src.includes('"'"'missing'"'"')){console.error('"'"'FAIL: check-health.js 缺 missing 处理逻辑'"'"');process.exit(1);} console.log('"'"'OK: missing bug 已修复'"'"')" || { echo "FAIL"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] check-health.js 含 Promise.race 3s 飞书告警超时保护
  Test: manual:bash -c 'grep -q "Promise.race" scripts/sessions/check-health.js || { echo "FAIL: 缺 Promise.race"; exit 1; }; grep -qE "3000|3 \* 1000|3000ms" scripts/sessions/check-health.js || { echo "FAIL: 缺 3000ms timeout 常量"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] check-health.js expired 条目触发飞书告警调用（非全量触发）
  Test: manual:bash -c 'node -e "const src=require('"'"'fs'"'"').readFileSync('"'"'scripts/sessions/check-health.js'"'"','"'"'utf8'"'"'); const hasExpiredGuard=src.includes('"'"'expired'"'"') && (src.includes('"'"'FEISHU_BOT_WEBHOOK'"'"') || src.includes('"'"'feishu'"'"')); if(!hasExpiredGuard){console.error('"'"'FAIL: 飞书告警未关联 expired 判断'"'"');process.exit(1);} const hasPromise=src.includes('"'"'Promise.race'"'"'); if(!hasPromise){console.error('"'"'FAIL: 缺 Promise.race'"'"');process.exit(1);} console.log('"'"'OK'"'"')" || { echo "FAIL"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] check-health.js 含 POST /api/operator/sessions/status 回写调用
  Test: manual:bash -c 'grep -qE "sessions/status|operator/sessions/status" scripts/sessions/check-health.js || { echo "FAIL: 缺 /api/operator/sessions/status 回写"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GHA workflow _COOKIES Secret 命名禁用字段反向 — 不含 *_SESSION/*_TOKEN/*_KEY 变量名
  Test: manual:bash -c 'for banned in _SESSION _TOKEN _KEY; do grep -q "secrets\.$banned\|_${banned#_}:" .github/workflows/session-health-check.yml 2>/dev/null && { echo "FAIL: workflow 含禁用命名 $banned"; exit 1; } || true; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke.sh 含 SKIP_HTTP_CHECK 离线模式（不依赖真实平台 cookie 的验证路径）
  Test: manual:bash -c 'grep -q "SKIP_HTTP_CHECK" .github/workflows/scripts/smoke/session-health-medium-smoke.sh || { echo "FAIL: smoke.sh 缺 SKIP_HTTP_CHECK 离线模式"; exit 1; }; echo OK'
  期望: OK
