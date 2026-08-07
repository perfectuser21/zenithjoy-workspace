# Contract Draft — W1-AI打表器 D2：采证器白名单点火 + 判定对接 + staging 版本戳

**TASK_ID**: `557c8bf4-b873-41f6-8ea8-c1d983da0a8f`
**GP_ID**: `7790f728-f490-4243-b166-03f3250a0938`
**Sprint 目录**: `sprints/w1-ai-scorer-d2`
**Contract 版本**: draft-r1
**起草时间**: 2026-08-07

---

## 背景

D1 数据层已合并主干（cecelia 1.270.0，migration 392-393），含 AI 四列/7 值状态机/36 格建行生成器/`POST /api/brain/acceptance/ai-results`（AI token 专属，只写 AI 列）。

D2 合同覆盖：**采证器（capture.mjs）→ 判定任务 → Brain ai-results 端点**完整链路，以及 staging 双端版本戳。

---

## 覆盖 FR 清单（共 12 项）

| FR# | 功能描述 | 合同断言覆盖 |
|-----|---------|------------|
| FR-01 | `cells-map.mjs` action 白名单（signup_flow → observe；S10-c4 → trigger_collect） | INV-1, INV-2, AC-1 |
| FR-02 | `login.mjs` 删 signup 回落，无凭据非零退出零回写 | INV-3, AC-2 |
| FR-03 | `capture.mjs` 开跑前双自检（租户 + device_model） | INV-11, AC-3 |
| FR-04 | `capture.mjs` trigger_collect 白名单四条约束 | INV-4, FR-04 behavior |
| FR-05 | S7-c2（5分钟）/ S9-c2（3分钟）自持轮询计时 | BEHAVIOR-2 |
| FR-06 | S4-c2 三档取数 | BEHAVIOR-3 |
| FR-07 | S10-c4 二次同关键词采集对照 | INV-2, AC-8 |
| FR-08 | 打表器 workflow（ubuntu-latest + allowlist + secrets 白名单） | INV-5, INV-6, INV-7, AC-7 |
| FR-09 | staging 后端 `GET /api/version`（挂 build-info 路由） | AC-6-backend |
| FR-10 | 前端 VITE_BUILD_SHA 注入（pin github.sha） | AC-6-frontend |
| FR-11 | 判定任务 → POST /api/brain/acceptance/ai-results 全 36 格零缺格 | INV-10, AC-4 |
| FR-12 | Brain 端点校验加固（scenario_not_triggered → 400；human_only 校验；mandatory 场景码 → 409） | INV-9, AC-5 |

---

## E2E 验收

### AC-1 — cells-map.mjs action 白名单（机械断言）

**用户语言**：`cells-map.mjs` 不得再有注册流动作，`trigger_collect` 恰好覆盖 S6-c3 和 S10-c4 两格，不多不少。

**技术断言**：

```bash
# 断言1：signup_flow 字样零出现
count=$(grep -c 'signup_flow' scripts/acceptance-spec/ai-run/cells-map.mjs); [ "$count" -eq 0 ] || (echo "FAIL: signup_flow 仍出现 $count 次" && exit 1)

# 断言2：trigger_collect 格恰为 ['S6-c3','S10-c4']
node -e "
import('./scripts/acceptance-spec/ai-run/cells-map.mjs').then(m => {
  const ids = m.CELLS_MAP.filter(c => c.action === 'trigger_collect').map(c => c.id).sort();
  const expected = ['S6-c3','S10-c4'];
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    console.error('FAIL: trigger_collect 格=' + JSON.stringify(ids) + ' 期望=' + JSON.stringify(expected));
    process.exit(1);
  }
  console.log('PASS: trigger_collect 格正确');
})"

# 断言3：S1-c3 的 action 为 observe，route 为 /area/acquisition/accounts
node -e "
import('./scripts/acceptance-spec/ai-run/cells-map.mjs').then(m => {
  const s1 = m.CELLS_MAP.find(c => c.id === 'S1-c3');
  if (!s1) { console.error('FAIL: S1-c3 not found'); process.exit(1); }
  if (s1.action !== 'observe') { console.error('FAIL: S1-c3 action=' + s1.action); process.exit(1); }
  if (!s1.route.includes('/area/acquisition/accounts')) { console.error('FAIL: S1-c3 route=' + s1.route); process.exit(1); }
  console.log('PASS: S1-c3 action=observe route 正确');
})"
```

### AC-2 — 无凭据非零退出零回写

**用户语言**：不给邮箱/密码时，采证器必须报错退出，不能偷偷注册新账号，也不能产出任何 ai-column.json。

**技术断言**：

```bash
# 清除凭据后跑 capture.mjs（仅做 resolveCredentials 单元测试），期望非零退出
node -e "
import { resolveCredentials } from './scripts/acceptance-spec/ai-run/login.mjs';
try {
  const r = resolveCredentials({}, {});
  if (r.mode === 'signup') { console.error('FAIL: 无凭据不得回落 signup，实际 mode=signup'); process.exit(1); }
  console.error('FAIL: 无凭据应抛错，实际返回', JSON.stringify(r));
  process.exit(1);
} catch(e) {
  console.log('PASS: 无凭据抛错=', e.message);
}"

# 验证 signup 关键词零出现
count=$(grep -c 'signup\|resolveCredentials.*signup' scripts/acceptance-spec/ai-run/login.mjs 2>/dev/null || echo 0); [ "$count" -eq 0 ] || (echo "FAIL: login.mjs 仍含 signup 路径，出现 $count 次" && exit 1)
```

### AC-3 — 双自检失败整轮 ai_incomplete 退出

**用户语言**：开跑前必须确认"登录的是专用验收租户"且"run-summary 里有单头那台设备在线"，任一不满足就整轮标 ai_incomplete 退出，不产出 ai-column。

**技术断言**（单元测试层，mock 自检失败）：

```bash
# 跑 sprints/w1-ai-scorer-d2/tests/preflight-check.test.mjs
node --experimental-vm-modules node_modules/.bin/jest sprints/w1-ai-scorer-d2/tests/preflight-check.test.mjs
# 期望：mock 租户不匹配 → exit code != 0 且无 ai-column 产出
# 期望：mock 设备不在线 → exit code != 0 且无 ai-column 产出
```

### AC-4 — 全 36 格回写零缺格

**用户语言**：跑完一轮，36 个建行格全都有判定结果（machine_db 格有 AI 判定，human_only 格写 reason='human_only'），DB 里不能有缺格。

**技术断言**：

```bash
# 单元：ai-column.json 格数 == 36
node -e "
const col = JSON.parse(require('fs').readFileSync('/tmp/test-ai-column.json','utf8'));
if (col.length !== 36) { console.error('FAIL: 格数=' + col.length); process.exit(1); }
console.log('PASS: 36 格全覆盖');
"

# 集成（需 Brain running）：POST 后 DB 无 ai_verdict IS NULL
curl -sf -X POST http://localhost:5221/api/brain/acceptance/ai-results \
  -H "Authorization: Bearer $ACCEPTANCE_AI_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/test-ai-column.json | jq '.missing_count == 0 or error("缺格")'
```

### AC-5 — scenario_not_triggered 被拒 400

**用户语言**：判定结果里不允许出现"场景未触发"这个 reason，一旦出现 Brain 必须拒绝整包并返回 400。

**技术断言**：

```bash
# POST 含 scenario_not_triggered 的 payload → 期望 400
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  http://localhost:5221/api/brain/acceptance/ai-results \
  -H "Authorization: Bearer $ACCEPTANCE_AI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"run_id":"test-run","cells":[{"id":"S6-c3","reason":"scenario_not_triggered"}]}')
[ "$HTTP_CODE" = "400" ] || (echo "FAIL: 期望 400，实际 $HTTP_CODE" && exit 1)
echo "PASS: scenario_not_triggered → 400"
```

### AC-6 — staging 版本戳双端可读

**用户语言**：能通过接口查到 staging 后端跑的是哪个代码版本（sha），前端页面上也能看到版本号。

**技术断言**：

```bash
# 后端：GET /api/version 返回含 sha 的 JSON（非 unknown）
RESP=$(curl -sf https://staging-autopilot.zenjoymedia.media/api/version)
SHA=$(echo "$RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); if(!j.sha||j.sha==='unknown'){console.error('FAIL: sha='+j.sha);process.exit(1);} console.log(j.sha);")
echo "PASS: backend sha=$SHA"

# 前端：页面 DOM 中可见 sha 字符串（页脚或 /admin 页）
# 跑 Playwright smoke：访问 staging，断言 document.body.innerText 含 $SHA 前 7 位
node -e "
const sha7 = process.env.EXPECTED_SHA?.slice(0,7);
// Playwright 断言见 sprints/w1-ai-scorer-d2/tests/version-stamp.spec.mjs
console.log('Playwright 测试已覆盖，见 tests/version-stamp.spec.mjs');
"
```

### AC-7 — workflow secrets 白名单正确

**用户语言**：打表器 CI 只拿三个凭据（staging 账号邮箱+密码 + AI token），绝对不拿 SSH 密钥、Tailscale 密钥或 API token（后者权限太大）。

**技术断言**：

```bash
# 解析 workflow yaml，断言三个禁止项零出现
for banned in ACCEPTANCE_API_TOKEN TAILSCALE_AUTHKEY HK_VPS_SSH_KEY; do
  count=$(grep -c "$banned" .github/workflows/acceptance-scorer.yml 2>/dev/null || echo 0)
  [ "$count" -eq 0 ] || (echo "FAIL: $banned 出现在 workflow secrets 白名单" && exit 1)
done
echo "PASS: secrets 白名单无禁止项"

# 断言允许项恰为三个
ALLOWED=$(grep -oE 'secrets\.[A-Z_]+' .github/workflows/acceptance-scorer.yml | sort -u)
echo "允许 secrets：$ALLOWED"
# 期望包含：secrets.STAGING_ACCEPTANCE_EMAIL secrets.STAGING_ACCEPTANCE_PASSWORD secrets.ACCEPTANCE_AI_TOKEN
```

### AC-8 — 二次采集对照（红线11）

**用户语言**：S10-c4 要做第二次同关键词采集，采集完后能在日志里看到"第二次采集"的页面对照记录。

**技术断言**：

```bash
# 检查 capture-log.txt 含第二次采集标记
grep -c '二次采集\|second_collect\|S10-c4.*trigger_collect\|round=2' /tmp/test-capture-log.txt \
  | xargs -I{} sh -c '[ {} -ge 1 ] || (echo "FAIL: 无二次采集日志" && exit 1)'
echo "PASS: 二次采集日志存在"
```

---

## 技术约束（来自 Invariant）

| 约束 | 实现要求 |
|------|---------|
| INV-1 | `cells-map.mjs` 的 action 枚举恰为 `{observe, trigger_collect}` |
| INV-2 | `trigger_collect` 格恰为 `['S6-c3','S10-c4']` |
| INV-3 | `login.mjs` 零 signup 回落路径；无凭据非零退出 |
| INV-4 | `capture.mjs` 全文零私信/关注/点赞触发代码 |
| INV-5 | workflow 固定 `ubuntu-latest`，零 `self-hosted`/`android-capable` |
| INV-6 | workflow secrets 不含 `ACCEPTANCE_API_TOKEN`/`TAILSCALE_AUTHKEY`/`HK_VPS_SSH_KEY` |
| INV-7 | Playwright allowlist 只放行 `staging-autopilot.zenjoymedia.media` |
| INV-8 | `opportunistic` 格数 == 0 |
| INV-9 | `reason='scenario_not_triggered'` → Brain 返回 400 |
| INV-10 | 全 36 格回写零缺格 |
| INV-11 | 双自检失败 → ai_incomplete 退出，零回写 |
| INV-12 | 采证产物不 commit 进 repo |

---

## 边界声明

- 本 sprint CI 固定 `ubuntu-latest`，物理无法连接手机池，零真机动作
- AI 打表器只走 `staging-autopilot.zenjoymedia.media` 只读观察与受控点火
- `ACCEPTANCE_AI_TOKEN` 只写 AI 四列，不写人列，不修改 `submitted_by`

---

## 实现顺序（对应 commit 序列）

```
commit-1: 写单测（INV-1~12 failing 断言，AC-1~8 failing E2E）
commit-2: FR-01 cells-map.mjs 白名单改动
commit-3: FR-02 login.mjs 删 signup 回落
commit-4: FR-03/04/05/06/07 capture.mjs 双自检 + 白名单点火 + 自持计时 + 三档取数 + 二次采集
commit-5: FR-08 workflow 新增
commit-6: FR-09 staging 后端 GET /api/version（挂 /api/version 别名到已有 build-info）
commit-7: FR-10 前端 VITE_BUILD_SHA 注入（deploy workflow pin github.sha）
commit-8: FR-11/12 判定对接 + Brain 端点校验加固
commit-9: 让所有单测和 E2E 通过
```
