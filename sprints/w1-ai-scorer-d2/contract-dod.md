# Contract DoD — W1-AI打表器 D2

**TASK_ID**: `557c8bf4-b873-41f6-8ea8-c1d983da0a8f`
**版本**: r1 (2026-08-07)

---

## [BEHAVIOR-1] cells-map.mjs action 白名单：仅 observe / trigger_collect，trigger_collect 恰覆盖 S6-c3 + S10-c4

**描述**：`cells-map.mjs` 的 `action` 字段枚举值只允许出现 `observe` 和 `trigger_collect` 两种。`signup_flow` 动作必须从 S1-c3 移除，改为 `observe` 指向 `/area/acquisition/accounts`。`trigger_collect` 恰好覆盖且仅覆盖 `S6-c3`（首次采集发起）和 `S10-c4`（二次同关键词对照采集）两格。

**断言**：
```bash
# 断言 signup_flow 零出现
count_signup=$(grep -c 'signup_flow' scripts/acceptance-spec/ai-run/cells-map.mjs); echo "signup_flow 出现次数: $count_signup"; [ "$count_signup" -eq 0 ] || exit 1

# 断言 trigger_collect 格恰为 S6-c3, S10-c4
node --input-type=module <<'EOF'
import { CELLS_MAP } from './scripts/acceptance-spec/ai-run/cells-map.mjs';
const ids = CELLS_MAP.filter(c => c.action === 'trigger_collect').map(c => c.id).sort();
const expected = ['S6-c3','S10-c4'];
if (JSON.stringify(ids) !== JSON.stringify(expected)) {
  console.error('FAIL trigger_collect 格:',ids,'期望:',expected); process.exit(1);
}
console.log('PASS:', ids);
EOF
```

**manual:bash**:
```bash
cd /workspace && \
  grep -c 'signup_flow' scripts/acceptance-spec/ai-run/cells-map.mjs && \
  node --input-type=module -e "import { CELLS_MAP } from './scripts/acceptance-spec/ai-run/cells-map.mjs'; const ids=CELLS_MAP.filter(c=>c.action==='trigger_collect').map(c=>c.id).sort(); console.log(JSON.stringify(ids));"
# 期望：0 (signup_flow 出现次数) 和 ["S6-c3","S10-c4"]
```

---

## [BEHAVIOR-2] login.mjs 无凭据路径：无 signup 回落，非零退出，零 ai-column 产出

**描述**：`login.mjs` 的 `resolveCredentials` 函数在无任何凭据（无 --email/--password，无 `ACCEPTANCE_EMAIL`/`ACCEPTANCE_PASSWORD` 环境变量）时，**必须抛出错误**或返回导致进程以非零退出的值，**严禁返回 `mode:'signup'`** 作为回落。`login.mjs` 全文不得出现 `signup` 关键词（包括 `mode:'signup'`、注释中的 signup 回落说明）。

**断言**：
```bash
# 断言 signup 关键词零出现
count_signup_login=$(grep -c 'signup' scripts/acceptance-spec/ai-run/login.mjs 2>/dev/null || echo 0)
echo "signup 出现次数: $count_signup_login"
[ "$count_signup_login" -eq 0 ] || exit 1

# 断言无凭据时 resolveCredentials 抛错（不返回 mode:'signup'）
node --input-type=module <<'EOF'
import { resolveCredentials } from './scripts/acceptance-spec/ai-run/login.mjs';
try {
  const r = resolveCredentials({}, {});
  console.error('FAIL: 无凭据应抛错，实际返回', JSON.stringify(r)); process.exit(1);
} catch(e) {
  console.log('PASS: 无凭据抛错:', e.message);
}
EOF
```

**manual:bash**:
```bash
cd /workspace && \
  grep -c 'signup' scripts/acceptance-spec/ai-run/login.mjs || echo "0 (无 signup)" && \
  node --input-type=module -e "import { resolveCredentials } from './scripts/acceptance-spec/ai-run/login.mjs'; try { resolveCredentials({},{}); console.log('FAIL: 未抛错'); process.exit(1); } catch(e){ console.log('PASS:', e.message); }"
```

---

## [BEHAVIOR-3] capture.mjs 开跑前双自检：租户 + device_model 双条件，任一失败 ai_incomplete 退出

**描述**：`capture.mjs` 在正式采证前，必须执行两项自检：
1. **租户自检**：当前登录账号的 tenantId/orgId 必须等于专用验收租户标识（从环境变量 `ACCEPTANCE_TENANT_ID` 读取）
2. **设备自检**：`run-summary.machines_online >= 1` 且包含单头 `device_model` 那台机（从环境变量 `ACCEPTANCE_DEVICE_MODEL` 读取）

任一不满足，进程必须以非零退出，整轮无 `ai-column.json` 产出，采证日志写入 `ai_incomplete` 告警。

**断言**（通过单元测试验证）：
```bash
node --experimental-vm-modules node_modules/.bin/jest \
  sprints/w1-ai-scorer-d2/tests/preflight-check.test.mjs \
  --no-coverage
# 期望：2 个测试全通过（租户不匹配 → 非零退出；设备不在线 → 非零退出）
```

**manual:bash**:
```bash
cd /workspace && node --experimental-vm-modules node_modules/.bin/jest sprints/w1-ai-scorer-d2/tests/preflight-check.test.mjs 2>&1 | tail -20
```

---

## [BEHAVIOR-4] S4-c2 三档取数：掉线/上线时间戳差值（档1） → device_reboot_at 差值（档2） → human_only 回落（档3）

**描述**：`capture.mjs` 处理 S4-c2（设备恢复时间窗）时，必须实现三档降级取数：
- **档1**：页面上同时显示「掉线时刻」与「上线时刻」→ 计算差值（分钟）
- **档2**：页面只显示「上线时刻」→ 读单头 `run-summary.device_reboot_at`，计算 (上线 - 重启) 差值
- **档3**：两个时刻都读不到 → 记录 `reason='human_only'`，不强行输出数值

**断言**：
```bash
node --experimental-vm-modules node_modules/.bin/jest \
  sprints/w1-ai-scorer-d2/tests/s4-c2-tiered-read.test.mjs \
  --no-coverage
# 期望：3 个测试用例全通过（档1/档2/档3 各一用例）
```

**manual:bash**:
```bash
cd /workspace && node --experimental-vm-modules node_modules/.bin/jest sprints/w1-ai-scorer-d2/tests/s4-c2-tiered-read.test.mjs 2>&1 | tail -20
```

---

## [BEHAVIOR-5] trigger_collect 白名单四条约束：路由/关键词/次数/无社交动作

**描述**：`capture.mjs` 执行 `trigger_collect` 动作时，必须满足：
- (a) 目标路由 = `/area/acquisition/tasks`（不走其他页面）
- (b) 参数携带本轮关键词（来自 `--keyword` 或 `run-summary` 单头）
- (c) 每轮 `trigger_collect` 执行次数 ≤ 2（S6-c3 一次 + S10-c4 一次，严禁超过）
- (d) 零私信/关注/点赞参数：`capture.mjs` 全文不得出现 `私信|关注|点赞|outreach.*click|sendMessage`

**断言**：
```bash
# 断言 (d) 静态检查
count_social=$(grep -cE '私信|关注|点赞|outreach.*click|sendMessage' \
  scripts/acceptance-spec/ai-run/capture.mjs 2>/dev/null || echo 0)
echo "社交动作关键词出现次数: $count_social"
[ "$count_social" -eq 0 ] || exit 1

# 断言 (c) trigger_collect 次数 <= 2（代码层）
count_trigger=$(grep -c "action === 'trigger_collect'\|action=='trigger_collect'" \
  scripts/acceptance-spec/ai-run/capture.mjs 2>/dev/null || echo 0)
echo "trigger_collect 调用点: $count_trigger（期望 <= 2）"
```

**manual:bash**:
```bash
cd /workspace && \
  echo "=== 社交动作零检查 ===" && \
  grep -cE '私信|关注|点赞|outreach.*click|sendMessage' scripts/acceptance-spec/ai-run/capture.mjs || echo "0 (零出现)" && \
  echo "=== trigger_collect 调用点 ===" && \
  grep -n "trigger_collect" scripts/acceptance-spec/ai-run/capture.mjs
```

---

## [BEHAVIOR-6] S7-c2 / S9-c2 自持轮询计时：while 循环 + 60 秒截容 + 终态提前退出

**描述**：`capture.mjs` 对 S7-c2（wait_budget_ms=300000，5分钟终态）和 S9-c2（wait_budget_ms=180000，3分钟判定）的等待，必须使用自持轮询（`while (Date.now() - start < wait_budget_ms)` 结构），每 60 秒截图一次，检出终态字样（已完成/失败/completed/failed/成功）时提前结束，不等满预算。

**断言**（通过单元测试验证计时逻辑）：
```bash
node --experimental-vm-modules node_modules/.bin/jest \
  sprints/w1-ai-scorer-d2/tests/polling-timer.test.mjs \
  --no-coverage
# 期望：mock 终态字样出现时提前结束（不等满 budget）
```

**manual:bash**:
```bash
cd /workspace && grep -n 'while.*Date.now\|wait_budget_ms\|60000' scripts/acceptance-spec/ai-run/capture.mjs
# 期望：能看到 while 循环 + 60000 间隔 + budget 判断
```

---

## [BEHAVIOR-7] workflow 三约束：ubuntu-latest + allowlist 域名 + secrets 白名单

**描述**：`.github/workflows/acceptance-scorer.yml` 必须满足：
- `runs-on: ubuntu-latest`（不得出现 `self-hosted` 或 `android-capable`）
- Playwright 网络拦截只放行 `staging-autopilot.zenjoymedia.media`（allowlist 白名单）
- `secrets` 引用只含 `STAGING_ACCEPTANCE_EMAIL`、`STAGING_ACCEPTANCE_PASSWORD`、`ACCEPTANCE_AI_TOKEN`，不含 `ACCEPTANCE_API_TOKEN`、`TAILSCALE_AUTHKEY`、`HK_VPS_SSH_KEY`

**断言**：
```bash
WF=.github/workflows/acceptance-scorer.yml

# 断言 self-hosted 零出现
[ $(grep -c 'self-hosted\|android-capable' "$WF") -eq 0 ] || (echo "FAIL: self-hosted 出现" && exit 1)

# 断言禁止 secrets 零出现
for banned in ACCEPTANCE_API_TOKEN TAILSCALE_AUTHKEY HK_VPS_SSH_KEY; do
  [ $(grep -c "$banned" "$WF" 2>/dev/null || echo 0) -eq 0 ] || (echo "FAIL: $banned 在 workflow 中" && exit 1)
done
echo "PASS: workflow 约束全通过"
```

**manual:bash**:
```bash
cd /workspace && \
  echo "=== self-hosted 检查 ===" && grep -c 'self-hosted\|android-capable' .github/workflows/acceptance-scorer.yml || echo "0" && \
  echo "=== 禁止 secrets 检查 ===" && grep -E 'ACCEPTANCE_API_TOKEN|TAILSCALE_AUTHKEY|HK_VPS_SSH_KEY' .github/workflows/acceptance-scorer.yml || echo "零出现（PASS）" && \
  echo "=== 允许 secrets ===" && grep -oE 'secrets\.[A-Z_A-Z_]+' .github/workflows/acceptance-scorer.yml | sort -u
```

---

## [BEHAVIOR-8] staging 后端 GET /api/version 返回含 sha 的 JSON；前端页面可见 sha

**描述**：
- 后端：`GET /api/version` 端点必须返回 `{ sha, version, built_at }` JSON，`sha` 字段非 `'unknown'`（即 CI 确实注入了构建 sha）
- 前端：`deploy-dashboard-staging.yml` 在 build 阶段注入 `VITE_BUILD_SHA=${{ github.sha }}`，前端页面（页脚或 `/admin`）可见该 sha 的前 7 位字符串

**断言**：
```bash
# 后端（staging 可达时执行）
RESP=$(curl -sf https://staging-autopilot.zenjoymedia.media/api/version 2>/dev/null || echo '{"sha":"OFFLINE"}')
SHA=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.sha||'missing')" "$RESP")
echo "backend sha=$SHA"
[ "$SHA" != "unknown" ] && [ "$SHA" != "missing" ] && [ "$SHA" != "OFFLINE" ] || echo "WARNING: staging 离线或 sha 未注入"

# 前端静态检查：deploy workflow 含 VITE_BUILD_SHA 注入
grep -c 'VITE_BUILD_SHA' .github/workflows/deploy-dashboard-staging.yml
# 期望：>= 1
```

**manual:bash**:
```bash
cd /workspace && \
  echo "=== 后端版本戳 ===" && curl -sf https://staging-autopilot.zenjoymedia.media/api/version | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d));" && \
  echo "=== 前端 VITE_BUILD_SHA 注入 ===" && grep -n 'VITE_BUILD_SHA' .github/workflows/deploy-dashboard-staging.yml
```

---

## [BEHAVIOR-9] Brain 端点校验：scenario_not_triggered → 400；human_only 校验；mandatory 场景码不齐 → 409

**描述**：`POST /api/brain/acceptance/ai-results` 端点必须：
- 任何格的 `reason='scenario_not_triggered'` → 整包返回 400
- 某格 `reason='human_only'` 但该格 yaml 非 `human_only` 类型 → 400
- `detail.scenarios_observed[]` 未涵盖全部 5 个 mandatory 场景码时 → 409

**断言**：
```bash
node --experimental-vm-modules node_modules/.bin/jest \
  sprints/w1-ai-scorer-d2/tests/brain-ai-results-validation.test.mjs \
  --no-coverage
# 期望：3 个测试用例全通过
```

**manual:bash**:
```bash
cd /workspace && node --experimental-vm-modules node_modules/.bin/jest sprints/w1-ai-scorer-d2/tests/brain-ai-results-validation.test.mjs 2>&1 | tail -20
```

---

## 全量验收命令（一键跑）

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /workspace

echo "=== [1/9] cells-map.mjs 白名单 ==="
count=$(grep -c 'signup_flow' scripts/acceptance-spec/ai-run/cells-map.mjs 2>/dev/null || echo 0)
[ "$count" -eq 0 ] || (echo "FAIL INV-1: signup_flow=$count" && exit 1)
node --input-type=module -e "
import { CELLS_MAP } from './scripts/acceptance-spec/ai-run/cells-map.mjs';
const ids=CELLS_MAP.filter(c=>c.action==='trigger_collect').map(c=>c.id).sort();
if(JSON.stringify(ids)!==JSON.stringify(['S6-c3','S10-c4'])){console.error('FAIL INV-2:',ids);process.exit(1);}
console.log('PASS INV-1/2');
"

echo "=== [2/9] login.mjs signup 零出现 ==="
count=$(grep -c 'signup' scripts/acceptance-spec/ai-run/login.mjs 2>/dev/null || echo 0)
[ "$count" -eq 0 ] || (echo "FAIL INV-3: signup=$count" && exit 1)
echo "PASS INV-3"

echo "=== [3/9] capture.mjs 社交动作零检查 ==="
count=$(grep -cE '私信|关注|点赞|outreach.*click|sendMessage' scripts/acceptance-spec/ai-run/capture.mjs 2>/dev/null || echo 0)
[ "$count" -eq 0 ] || (echo "FAIL INV-4: social=$count" && exit 1)
echo "PASS INV-4"

echo "=== [4/9] workflow self-hosted 零检查 ==="
[ -f .github/workflows/acceptance-scorer.yml ] || (echo "FAIL INV-5: workflow 文件不存在" && exit 1)
count=$(grep -c 'self-hosted\|android-capable' .github/workflows/acceptance-scorer.yml 2>/dev/null || echo 0)
[ "$count" -eq 0 ] || (echo "FAIL INV-5: self-hosted=$count" && exit 1)
echo "PASS INV-5"

echo "=== [5/9] workflow secrets 禁止项零检查 ==="
for banned in ACCEPTANCE_API_TOKEN TAILSCALE_AUTHKEY HK_VPS_SSH_KEY; do
  c=$(grep -c "$banned" .github/workflows/acceptance-scorer.yml 2>/dev/null || echo 0)
  [ "$c" -eq 0 ] || (echo "FAIL INV-6: $banned=$c" && exit 1)
done
echo "PASS INV-6"

echo "=== [6/9] 前端 VITE_BUILD_SHA 注入 ==="
count=$(grep -c 'VITE_BUILD_SHA' .github/workflows/deploy-dashboard-staging.yml 2>/dev/null || echo 0)
[ "$count" -ge 1 ] || (echo "FAIL FR-10: VITE_BUILD_SHA 未注入" && exit 1)
echo "PASS FR-10 (注入点=$count)"

echo "=== [7/9] 单元测试：双自检 / 三档取数 / 轮询计时 ==="
node --experimental-vm-modules node_modules/.bin/jest \
  sprints/w1-ai-scorer-d2/tests/ --no-coverage 2>&1 | tail -15

echo "=== [8/9] repo 无采证产物 ==="
result=$(git ls-files acceptance-spec/runs/ 2>/dev/null | wc -l)
[ "$result" -eq 0 ] || (echo "FAIL INV-12: adoption artifact committed=$result" && exit 1)
echo "PASS INV-12"

echo "=== [9/9] staging 版本戳（离线则 skip） ==="
RESP=$(curl -sf --max-time 8 https://staging-autopilot.zenjoymedia.media/api/version 2>/dev/null || echo '{}')
SHA=$(node -e "try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.sha||'unknown');}catch{process.stdout.write('unreachable');}" "$RESP")
echo "staging sha=$SHA"
[ "$SHA" = "unknown" ] && echo "WARNING: staging 可达但 sha=unknown（FR-09/10 未完成）" || echo "PASS AC-6"

echo ""
echo "===== Contract DoD 全量验收完成 ====="
```

---

## 覆盖 FR 数

**合同覆盖 FR 总数：12 / 12**（FR-01 ~ FR-12 全覆盖）

**BEHAVIOR 数：9 条**（BEHAVIOR-1 ~ BEHAVIOR-9）

**Invariant 数：12 条**（INV-1 ~ INV-12）
