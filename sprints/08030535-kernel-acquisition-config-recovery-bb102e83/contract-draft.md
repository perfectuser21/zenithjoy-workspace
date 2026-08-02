# Sprint Contract Draft (Round 2)

## Notes

- 本合同只恢复 PR #1581 的验收与独立盲审，不生成新 candidate、不修改产品代码、不修改共享 Red fixture，也不执行 merge。
- 目标 SHA 固定为 `c305f6217da65bb69413c39e621b7e797e0fb189`；冻结 workspace 基线为 `28aead2e9a4baff9cd1643a4fcec78086096c49a`；仓库历史核实的共享 Red 冻结提交为 `b937e1d39a81c4a46d06a83a84886facb79d7ba2`。
- `gh pr view 1581` 已核实 PR 当前为 OPEN、head 精确等于目标 SHA、未合并。API/DB/test registry 可达；本任务不新增 HTTP schema 或 DB schema。context-manifest: unavailable（HTTP 404）。
- contract-gate: skipped (file not found, third-party repo)
- `npm run product-map:check` 在 `npm ci` 后通过，digest `5011e4ef...`，无分类漂移。
- Round 2 仅修复 Reviewer 指出的 DB 一致性缺口：从 Fleet 的 `DB_URL` 派生 API 实际读取的五个拆分式 `DATABASE_*` 变量，并以真实 API 写入后 `psql "$DB_URL"` 精确回读证明 migration、API 与 oracle 命中同一 attempt 空库。

## Response Schema（推导来源: PRD字面）

N/A — 本任务不新增或修改 HTTP 响应。Evaluator 与 Judge 的文件结果沿用 Harness 结构：顶层 `verdict`、`anchor_sha`、`exit_code`、`log_tail`、`behavior_tests[]`；每个 behavior test 必含 `exit_code` 与非空 `log_tail`。

## 已知约束（来自回归测试）

- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → `Kernel acquisition effective-config guard [BEHAVIOR]`（目标 SHA 已包含的真路由、真 Postgres 回归合同）。
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`（共享 Red fixture，候选不得修改）。
- `.github/workflows/scripts/smoke/acquisition-config-validation-smoke.sh` → 完整更新、非法 partial 400/零写入、合法 partial 真 API + Postgres smoke。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（HTTP 404）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 从 evaluate 恢复，对 PR #1581 精确 SHA 依次取得 Evaluator 与 Independent Judge 独立结论，仅双 PASS 且 SHA 相同才发出 merge-ready 信号。 |
| NFR（做得多好） | 时限/可靠性 | 全流程 ≤7200s；任一外部调用、证据解析、SHA 比对失败均 fail-closed。 |
| Invariant（永不违反） | 安全/一致性 | 不换 SHA、不改共享 Red、不读其他 candidate、不在双结论前 merge、不打印凭据。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 退役责任 | 任一 PR head 变化、结论文件被替换或 merge 状态变化即过期，controller 必须重新 evaluate + judge。 |
| 死亡告警（停了谁知道） | 故障发现 | Harness 结构化非零结果与 log_tail 立即交 controller；bridge 失败保留 SHA 和原因，不回退。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | fail-closed；只允许在同一 SHA 上重试，不降级为单方结论或旧 PR。 |
| 效果确认（已发≠已生效） | 生效回执 | GitHub 真 API 对账 PR head/open/merge 状态；真 Postgres 业务 smoke；双结果文件逐字段一致性校验。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 是否仍为本次可验收对象 | A. 使用本地分支名；B. GitHub API 读取 head OID、state、mergeCommit | B. GitHub API 精确对账 | 分支名可漂移，OID 才是不可变对象 | 验错代码或提前合并 |
| ⚠️ 双结论是否足以放行 | A. 任一 PASS；B. 两份结构化 PASS 且 anchor SHA 完全相同 | B. 双 PASS + 三方 SHA 等值 | PRD 明确要求独立双重结论 | 单方假阳性直接进入 merge |

judgment-pending-user: PR #1581 是否仍为本次可验收对象（PRD 已给精确 SHA，本合同按该字面值执行）
judgment-pending-user: 双结论是否足以放行（PRD 已明确双 PASS，本合同不扩展判定）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| PR head/state/merge 状态漂移 | 非零退出并记录实际值与目标 SHA | 是，同一 SHA 可重跑 | 不替换 SHA、不回退 PR #1579 |
| Evaluator 或 Judge 缺失/格式无效/失败 | `merge_ready=false`，保留角色 log_tail | 是，重跑失败角色后两份重新对账 | 禁止单方放行 |
| bridge 或 GitHub API 不可达 | 非零退出并记录 endpoint/错误类别 | 是 | 不用缓存值冒充实时真相 |

### 输入对抗面

N/A — 本任务不新增对外 agent；证据文件视为不可信输入，必须 JSON 解析、schema 校验并与固定 SHA 比较。

## 真实调用方请求 shape

- GitHub 真实调用为 `gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json number,state,headRefOid,mergeCommit,url`；认证只由 `gh` 的短期运行时凭据提供，不写入命令、文件或日志。
- local_api 业务调用使用真实 `POST /api/auth/sign-up/email` 创建两个临时用户和 cookie jar；随后 `Cookie` + `Content-Type: application/json` 调 `PUT /api/acquisition/config`。tenant 不通过 body/header 伪造，而从真实 signup user id 对应的 `tenant_members` 查询取得并验证隔离。
- Harness 角色结果为 JSON 文件，不通过请求 body 注入 SHA；Evaluator 与 Judge 都必须在顶层 `anchor_sha` 写精确目标 SHA。

## 禁 mock 边清单

- GitHub PR #1581 ↔ evaluator 目标选择：必须真调 GitHub API，不得以本地假 ref 或 fixture 代替。
- target SHA 的生产 API 路由/service ↔ attempt Postgres：必须在 target SHA worktree 上运行真实 migration、真实 HTTP app 与真实 Postgres，禁止 mock router/service/DB。
- Evaluator 结果 ↔ Independent Judge 结果 ↔ merge gate：必须读取两份独立结果文件逐字段对账，禁止复制一份生成另一份。

## 未覆盖真实链路清单

（本合同无 force、stub、mock 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] GitHub PR 实时状态 ↔ 精确 target SHA：真调 `gh pr view` 两次；任一次漂移即 FAIL。
- [接缝×2] target SHA 真实 API ↔ attempt 空库 Postgres：真实 migration/signup/cookie/双租户业务请求；重复两次不一致判 FLAKY。
- [接缝×2] Evaluator ↔ Independent Judge ↔ merge gate：controller 在两角色完成后执行结果对账；缺失或不一致保持 `logic-done-pending`，不得标 done。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[显式恢复并锁定 PR/SHA/基线] → [Evaluator 真验 target SHA] → [Independent Judge 独立盲审同一 SHA] → [双结论一致才发 merge-ready 信号]

### Step 1: 锁定 PR #1581、目标 SHA 与冻结比较输入
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步、「边界情况」与「验收标准」。

**可观测行为**: GitHub 实时返回 PR OPEN、未合并、head 精确等于目标 SHA；共享 Red fixture 相对冻结提交零 diff；当前恢复不读取其他 candidate。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json state,headRefOid,mergeCommit | jq -e '.state=="OPEN" and .headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .mergeCommit==null' && git diff --exit-code b937e1d39a81c4a46d06a83a84886facb79d7ba2 c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts
```
**硬阈值**: 两条命令 exit 0；head 40 位逐字相等；fixture 零 diff；耗时 ≤30s。

### Step 2: Evaluator 在 target SHA 上完成真实 local_api 验收
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步与「验收标准」。

**可观测行为**: attempt 空库先跑 target SHA 的真实 migration；由同一 `DB_URL` 派生 API 实际读取的 `DATABASE_HOST/PORT/NAME/USER/PASSWORD` 后启动真实 API；两个 signup cookie 对应两个 tenant；真实 API 写入可由 `psql "$DB_URL"` 精确回读，effective-config 非法更新 400/零写入、合法更新成功且租户隔离；Evaluator 结构化结果锚定 target SHA。

**验证命令**:
```bash
RECOVERY_EVIDENCE_DIR="${RECOVERY_EVIDENCE_DIR:?}" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts -t "Evaluator 结构化结论锚定目标 SHA 且行为证据全部通过"
```
**硬阈值**: migration/app/signup/业务 smoke 均 exit 0；API 写入 tenant A/B 的 `3|5`、`2|8` 必须由 `psql "$DB_URL"` 精确回读；Evaluator 顶层及每条 behavior test 的 exit_code=0、log_tail 非空、anchor_sha 精确相等；业务链 ≤180s。

### Step 3: Independent Judge 对同一 SHA 独立复核
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与「范围限定」。

**可观测行为**: Judge 只接收 target SHA 与 Evaluator 留证，不读取或复制其他 candidate；输出独立结构化 PASS，且 `candidate_sources_read=[]`。

**验证命令**:
```bash
RECOVERY_EVIDENCE_DIR="${RECOVERY_EVIDENCE_DIR:?}" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts -t "Independent Judge 独立结论锚定同一目标 SHA 且未读取其他 candidate"
```
**硬阈值**: Judge `independent=true`、`candidate_sources_read=[]`、exit_code=0、log_tail 非空、behavior_tests 非空且逐项 exit_code=0；anchor_sha 精确相等。

### Step 4: 双结论一致后才产生可合并信号
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步与「边界情况」。

**可观测行为**: merge-gate 只有在 Evaluator/Judge 双 PASS 且三个 SHA 一致时为 `merge_ready=true`；生成信号后再次真查 PR 仍 OPEN/未合并。本 Sprint 不执行 merge。

**验证命令**:
```bash
RECOVERY_EVIDENCE_DIR="${RECOVERY_EVIDENCE_DIR:?}" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts -t "双结论一致后才产生精确 SHA 的可合并信号" && gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json state,headRefOid,mergeCommit | jq -e '.state=="OPEN" and .headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .mergeCommit==null'
```
**硬阈值**: `merge_ready=true` 只对应 target SHA；第二次 GitHub API 查询 exit 0 且仍未 merge；任一缺失/漂移必须非零。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
: "${RECOVERY_EVIDENCE_DIR:?controller must provide evaluator/judge/merge-gate evidence directory}"
TARGET_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
FROZEN_RED_SHA="b937e1d39a81c4a46d06a83a84886facb79d7ba2"
REPO="perfectuser21/zenithjoy-workspace"
PR_NUMBER=1581
API_PORT="${API_PORT:-33581}"
BASE_URL="http://127.0.0.1:${API_PORT}"
WORKTREE=$(mktemp -d)
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
APP_PID=""
cleanup() { set +e; [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null; [ -z "$APP_PID" ] || wait "$APP_PID" 2>/dev/null; git worktree remove --force "$WORKTREE" >/dev/null 2>&1; rm -f "$COOKIE_A" "$COOKIE_B" /tmp/kernel-r4-signup-a.json /tmp/kernel-r4-signup-b.json; }
trap cleanup EXIT
for bin in gh git jq curl psql node npm; do command -v "$bin" >/dev/null || { echo "FAIL: missing $bin"; exit 1; }; done
PR_BEFORE=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json state,headRefOid,mergeCommit)
echo "$PR_BEFORE" | jq -e --arg sha "$TARGET_SHA" '.state=="OPEN" and .headRefOid==$sha and .mergeCommit==null' >/dev/null
git fetch origin "pull/${PR_NUMBER}/head:refs/remotes/origin/pr-${PR_NUMBER}-head" --force
[ "$(git rev-parse --verify "refs/remotes/origin/pr-${PR_NUMBER}-head^{commit}")" = "$TARGET_SHA" ]
git diff --exit-code "$FROZEN_RED_SHA" "$TARGET_SHA" -- apps/api/tests/routes/acquisition-dispatch.test.ts
git worktree add --detach "$WORKTREE" "$TARGET_SHA" >/dev/null
cd "$WORKTREE"
npm ci --prefer-offline >/tmp/kernel-r4-npm-ci.log 2>&1
# migration 读取 DATABASE_URL；业务 API 的 apps/api/src/db/connection.ts 只读取拆分式变量。
# 两组变量必须由 Fleet 注入的同一个 DB_URL 派生，禁止使用默认库或第二条连接串。
node -e 'const u=new URL(process.env.DB_URL);if(!/^postgres(ql)?:$/.test(u.protocol)||!u.hostname||!u.pathname.slice(1)||!u.username)process.exit(1)'
export DATABASE_URL="$DB_URL"
export DATABASE_HOST="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')"
export DATABASE_PORT="$(node -e 'const u=new URL(process.env.DB_URL);process.stdout.write(u.port||"5432")')"
export DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))')"
export DATABASE_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')"
export DATABASE_PASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')"
export PORT="$API_PORT" BETTER_AUTH_URL="$BASE_URL" NODE_ENV=test
npm run migrate --workspace=apps/api >/tmp/kernel-r4-migrate.log 2>&1
psql "$DB_URL" -Atc "SELECT (to_regclass('zenithjoy.acquisition_config') IS NOT NULL) AND (to_regclass('zenithjoy.tenant_members') IS NOT NULL)" | grep -qx t
npm run build --workspace=apps/api >/tmp/kernel-r4-build.log 2>&1
node apps/api/dist/index.js >/tmp/kernel-r4-api.log 2>&1 & APP_PID=$!
for i in $(seq 1 60); do curl -fsS "$BASE_URL/health" >/dev/null && break; kill -0 "$APP_PID" 2>/dev/null || { tail -40 /tmp/kernel-r4-api.log; exit 1; }; [ "$i" -lt 60 ] || { echo "FAIL: API not ready within 60s"; exit 1; }; sleep 1; done
EMAIL_A="kernel-r4-a-${RANDOM}-$(date +%s)@example.invalid"
EMAIL_B="kernel-r4-b-${RANDOM}-$(date +%s)@example.invalid"
curl -fsS -c "$COOKIE_A" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL_A\",\"password\":\"Temporary-Aa1!\",\"name\":\"Kernel A\"}" "$BASE_URL/api/auth/sign-up/email" >/tmp/kernel-r4-signup-a.json
curl -fsS -c "$COOKIE_B" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL_B\",\"password\":\"Temporary-Bb2!\",\"name\":\"Kernel B\"}" "$BASE_URL/api/auth/sign-up/email" >/tmp/kernel-r4-signup-b.json
USER_A=$(jq -er '.user.id // .id' /tmp/kernel-r4-signup-a.json)
USER_B=$(jq -er '.user.id // .id' /tmp/kernel-r4-signup-b.json)
TENANT_A=$(psql "$DB_URL" -Atc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='${USER_A}' ORDER BY created_at DESC LIMIT 1")
TENANT_B=$(psql "$DB_URL" -Atc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='${USER_B}' ORDER BY created_at DESC LIMIT 1")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ "$TENANT_A" != "$TENANT_B" ]
curl -fsS -b "$COOKIE_A" -H 'content-type: application/json' -X PUT "$BASE_URL/api/acquisition/config" -d '{"keywords_per_round_min":3,"keywords_per_round_max":5}' | jq -e '.success==true and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==5' >/dev/null
curl -fsS -b "$COOKIE_B" -H 'content-type: application/json' -X PUT "$BASE_URL/api/acquisition/config" -d '{"keywords_per_round_min":2,"keywords_per_round_max":8}' | jq -e '.success==true and .data.keywords_per_round_min==2 and .data.keywords_per_round_max==8' >/dev/null
# 同库探针：API 使用拆分式变量写入后，必须能从原始 Fleet DB_URL 精确回读。
SAME_DB_PROBE=$(psql "$DB_URL" -Atc "SELECT tenant_id::text||'|'||keywords_per_round_min||'|'||keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}') AND created_at > NOW()-interval '5 minutes' ORDER BY tenant_id")
echo "$SAME_DB_PROBE" | grep -Fx "${TENANT_A}|3|5" >/dev/null
echo "$SAME_DB_PROBE" | grep -Fx "${TENANT_B}|2|8" >/dev/null
BEFORE=$(psql "$DB_URL" -Atc "SELECT keywords_per_round_min||'|'||keywords_per_round_max||'|'||updated_at::text FROM zenithjoy.acquisition_config WHERE tenant_id='${TENANT_A}'")
CODE=$(curl -sS -b "$COOKIE_A" -o /tmp/kernel-r4-invalid.json -w '%{http_code}' -H 'content-type: application/json' -X PUT "$BASE_URL/api/acquisition/config" -d '{"keywords_per_round_min":10}')
[ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' /tmp/kernel-r4-invalid.json >/dev/null
AFTER=$(psql "$DB_URL" -Atc "SELECT keywords_per_round_min||'|'||keywords_per_round_max||'|'||updated_at::text FROM zenithjoy.acquisition_config WHERE tenant_id='${TENANT_A}'")
[ "$AFTER" = "$BEFORE" ]
psql "$DB_URL" -Atc "SELECT count(*) FROM zenithjoy.acquisition_config WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}') AND created_at > NOW()-interval '5 minutes' AND keywords_per_round_min<=keywords_per_round_max" | grep -qx 2
npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
cd - >/dev/null
RECOVERY_EVIDENCE_DIR="$RECOVERY_EVIDENCE_DIR" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts --reporter=verbose
PR_AFTER=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json state,headRefOid,mergeCommit)
echo "$PR_AFTER" | jq -e --arg sha "$TARGET_SHA" '.state=="OPEN" and .headRefOid==$sha and .mergeCommit==null' >/dev/null
echo "PASS: PR #1581 target_sha=$TARGET_SHA evaluator+judge exact-SHA evidence valid; merge-ready signal only; PR remains unmerged"
```

通过标准：真实 GitHub API 前后两次均为 OPEN/未合并/精确 SHA；target SHA worktree 在本 attempt 空库真实 migration；API 的五个拆分式 DB 变量均由同一 `DB_URL` 派生；两个真实 signup cookie 产生不同 tenant；API 写入后 `psql "$DB_URL"` 精确回读两租户配置；非法 effective config 400 `INVALID_CONFIG` 且 DB 行含时间戳完全不变；共享 Red test 通过且 fixture 零 diff；Evaluator/Judge/merge-gate 三文件结构及 SHA 全部通过。任一资源或证据不可用必须非零。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: evidence JSON 缺 `anchor_sha`、`behavior_tests` 或 behavior `log_tail`，必须拒绝。
- 重复提交: 同一 SHA 的 merge-gate 对账连续执行两次，结果应一致且不触发 merge。
- 中途中断: GitHub/bridge 查询中断或 Judge 文件只写一半时，必须保持不可合并。
- 边界值: PR head 在两次查询之间变化、Evaluator PASS/Judge FAIL、两份 SHA 只差一个字符、空 behavior_tests。
发现分级: P0/P1（验错 SHA、单方放行、提前 merge、共享 Red 被改）阻塞；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Evaluator 精确 SHA 证据 | `tests/recovery-evidence-contract.test.ts` | `Evaluator 结构化结论锚定目标 SHA 且行为证据全部通过` | evidence 不存在，readFileSync ENOENT |
| Judge 独立同 SHA 证据 | `tests/recovery-evidence-contract.test.ts` | `Independent Judge 独立结论锚定同一目标 SHA 且未读取其他 candidate` | evidence 不存在，readFileSync ENOENT |
| 双结论 merge gate | `tests/recovery-evidence-contract.test.ts` | `双结论一致后才产生精确 SHA 的可合并信号` | evidence 不存在，readFileSync ENOENT |
