# Sprint Contract Draft (Round 2)

## Notes

- 本合同只验证 PR #1581 的精确目标提交，不修改业务实现、不复制旧证据、不修改共享 Red fixture、不执行合并。
- contract-gate: skipped (file not found, third-party repo)
- Registry 可达但未发现本验证任务专属 HTTP schema；累积 FR 为“本 line 暂无历史”。
- `npm run product-map:check` 因当前 workspace 缺锁定依赖 `ajv` 失败；此环境故障不得记为验证通过，依赖安装后须重跑。
- GAN authoring provenance 仅为当前合同作者信息；未来 Generator、Evaluator、Judge 的身份一律由各角色 Runner 在执行时注入，禁止把当前 attempt/capability snapshot 固化为验收身份。
- GP 使用 `keep-green`：本 Sprint 验证既有 step7 对应改动，不修改该 GP 的 smoke file。

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 不新增 HTTP 响应；证据 JSON 结构由本合同与失败测试锁定。

## Kernel validation identity（late-bound）

每个角色在自己的证据中记录自己的 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST` 与 `CAPABILITY_SNAPSHOT_ID`。Generator、Evaluator、Judge 的 `attempt_id` 与 `capability_snapshot_id` 必须分别两两不相等；account 记录实际 Runner 值，不把作者身份固化为未来角色期望：

- Generator 证据 `evidence/generator.json` 记录真实产品执行、目标 SHA 与自身运行身份，并产生不可变 receipt。
- Evaluator 证据 `evidence/evaluator.json` 记录自身运行身份，并以 `generator_receipt_sha256` 引用 Generator receipt。
- Judge 证据 `evidence/judge.json` 记录自身运行身份，并以 `evaluator_evidence_sha256` 引用 Evaluator 文件摘要。
- 稳定对象可固定：run_id `5172f36e-d86c-45cf-a417-b2678c2ec3e4`、仓库、PR #1581、冻结基线 `676fed7de12023d355deac7849af8a525ae53f8d`、目标 SHA `c305f6217da65bb69413c39e621b7e797e0fb189`。

任何未来角色证据若缺少其运行时身份、摘要引用断裂、目标 SHA 漂移或机器不是 `us-mac-m4`，均 fail-closed。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → partial patch cannot make merged keyword bounds invalid。
- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → 真 Postgres 下非法有效态、合法更新、并发串行与双租户隔离。
- `[累积FR]` 本 line 暂无历史。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 对 PR #1581 精确 SHA 在严格 us-mac-m4 完成新鲜 Generator、Evaluator、Judge 链路并输出最终 verdict。 |
| NFR（做得多好） | 性能/可靠性 | 总预算 7200s；精确 SHA、角色身份、机器和证据摘要逐字可核查。 |
| Invariant（永不违反） | 安全/一致性 | 不复用旧证据、不 fallback、不改共享 fixture、不在 verdict 前合并；每个角色保存自己的 late-bound provenance。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 退役责任 | PR head、目标 SHA 或角色 attempt 任一变化即过期并全量重跑。 |
| 死亡告警（停了谁知道） | 故障发现 | 任一角色非通过或超时必须输出非零、log_tail 和 evidence，控制面阻断后续放行。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | fail-closed；新 attempt 从头执行，禁止旧 evidence 补位或换机器。 |
| 效果确认（已发≠已生效） | 生效回执 | 真产品 exit 0、Evaluator PASS、Judge 最终 verdict、摘要链和 GitHub 未合并状态共同确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR head 是否仍为目标提交 | A. 本地 ref；B. GitHub PR API | B. 执行前后查询 GitHub API | 防止本地旧 ref 掩盖远端漂移 | 错误代码被裁决 |
| ⚠️ 三角色证据是否新鲜独立 | A. 看文本；B. 核验各自 runtime identity 与摘要链 | B. 全字段与 SHA-256 串联 | 当前 authoring identity 不能代表未来角色 | 旧证据或身份冒充 |
| 严格 affinity 是否满足 | A. 任务标签；B. 每份证据的实际 machine | B. 核验 `HARNESS_MACHINE` 产物 | 标签不证明实际执行位置 | 未授权机器冒充 |

judgment-pending-user: PR head 是否仍为目标提交
judgment-pending-user: 三角色证据是否新鲜独立

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| PR SHA 漂移或已合并 | 当前验证立即失败并保留观察值 | 是，新 SHA/new attempt 全量重跑 | 无 |
| us-mac-m4 不可用 | 非零退出 | 是，原机器恢复后重派 | 禁止 fallback |
| 角色身份或摘要链缺失 | 后续角色拒绝出 PASS | 是，缺失角色用新 attempt 重跑 | 禁止补写旧证据 |
| 产品 API/DB 验证失败 | Generator 证据记录真实失败 | 是，修复后新 attempt | 禁止吞错 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或用户输入接口。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

## 真实调用方请求 shape

产品验证沿用生产 Web 调用方：`Content-Type: application/json`；真实 `/api/auth/sign-up/email` 建立 session cookie，后续 `/api/acquisition/config` 通过该 cookie 鉴权；请求体字段逐字为 `keywords_per_round_min`、`keywords_per_round_max`。不接受 body 内伪造 tenant_id。

## 禁 mock 边清单

- GitHub PR #1581 ↔ exact-SHA worktree：必须查询真实远端 head 并检出该 commit。
- acquisition route ↔ service ↔ Postgres：必须用同一空库完成 migration、真实 signup/cookie 与配置读写，禁止 mock route、service、pool 或 transaction client。
- Generator receipt ↔ Evaluator evidence ↔ Judge verdict：必须用文件内容 SHA-256 串联，禁止复制结论或固化 GAN authoring identity。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] GitHub PR head ↔ exact-SHA worktree：执行前后各查询一次；任一次漂移即失败。
- [接缝×2] 真 Postgres ↔ production auth/router/service：空库 migration、signup、cookie 与业务请求使用同一 `DB_URL`；真验前为 `logic-done-pending`。
- [接缝×2] Generator ↔ Evaluator ↔ Judge：各自 runtime identity 与摘要链重复核验；两次不一致判 FLAKY；真验前为 `logic-done-pending`。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[冻结目标] → [Generator 真链验证] → [Evaluator 独立验收] → [Judge 最终裁决且保持未合并]

### Step 1: 冻结基线、目标 SHA 与严格机器
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: GitHub PR head 和实际检出 commit 均等于目标 SHA；每个执行角色自报实际机器为 us-mac-m4。

**验证命令**: `H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha) && [ "$H" = c305f6217da65bb69413c39e621b7e797e0fb189 ] && [ "$HARNESS_MACHINE" = us-mac-m4 ]`

**硬阈值**: head、checkout SHA 逐字相等，机器逐字等于 us-mac-m4；命令 exit 0。

### Step 2: Generator 在精确 SHA 跑真实产品链
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及「范围限定」。

**可观测行为**: attempt 空库完成真实 migration/signup/cookie 后，双租户 effective-config 合法更新、非法部分更新拒绝；同一租户的两条冲突 PATCH 真实并发发出，仅一条成功、另一条返回 `INVALID_CONFIG`，最终 `min <= max`；Generator receipt 绑定本角色 runtime identity。

**验证命令**: `npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Generator 新鲜证据绑定运行时身份和目标 SHA" --reporter=verbose`

**硬阈值**: product_validation.exit_code=0，并发响应状态码排序后精确为 `[200,400]`，失败响应 code=`INVALID_CONFIG`，最终 `min <= max`，总耗时 ≤7200s，final_sha 精确相等，Generator machine=us-mac-m4。

### Step 3: Evaluator 独立验证并引用 Generator receipt
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2-3 步。

**可观测行为**: Evaluator 用自己的 Runner identity 产生结构完整 evidence，PASS 时 `generator_receipt_sha256` 与实际 Generator receipt 摘要一致，且其 attempt/capability snapshot 均与 Generator 不同。

**验证命令**: `npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Evaluator 使用自己的身份并引用 Generator receipt 摘要" --reporter=verbose`

**硬阈值**: exit_code=0、behavior_tests 非空且完整、verdict=PASS、摘要精确相等、Generator/Evaluator 的 attempt 与 capability snapshot 分别不相等。

### Step 4: Judge 基于 Evaluator evidence 给出最终 verdict
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与边界情况。

**可观测行为**: Judge 使用自己的 Runner identity，以 Evaluator 文件 SHA-256 为输入；三角色 attempt/capability snapshot 分别两两不相等；结果明确为 PASS/FAIL/INSUFFICIENT_EVIDENCE，并直接核验 verdict 前 PR 未合并。

**验证命令**: `PR=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581) && echo "$PR" | jq -e '.state=="open" and .merged==false and .merged_at==null and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189"' && npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Judge 使用自己的身份引用 Evaluator 摘要且裁决前未合并" --reporter=verbose`

**硬阈值**: Judge evidence 摘要引用一致；三角色 attempt 与 capability snapshot 各自集合大小均为 3；GitHub 状态 open、merged=false、merged_at=null；命令 exit 0。

### Step 5: 防止 authoring identity 固化
**来源**: `[AI_ADDED]` — Kernel v9.20 late-binding 规则要求机械阻断未来角色复用当前起草身份。

**可观测行为**: 合同与测试不含当前 proposer attempt/capability UUID；运行证据只能从各角色 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID` 注入值生成。

**验证命令**: `! rg -n '(attempt_id|capability_snapshot_id).*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' sprints/08040600-kernel-pr1581-fleet-validation-r17/contract-draft.md sprints/08040600-kernel-pr1581-fleet-validation-r17/contract-dod.md sprints/08040600-kernel-pr1581-fleet-validation-r17/tests`

**硬阈值**: 搜索无命中且 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 篡改任一角色的 final_sha、machine、attempt_id、capability snapshot 或摘要引用。
- 重复提交: 重放旧 Generator/Evaluator 文件，确认摘要与 runtime identity 闸拒绝。
- 中途中断: Generator 完成后中断 Evaluator 或 Judge，确认不能产生最终 PASS。
- 边界值: PR head 在执行前后两次查询之间变化；运行时恰好 7200s。
发现分级: P0/P1（错误 SHA、旧证据、未授权机器或提前合并）阻塞；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Generator 证据 | `tests/fleet-validation-evidence.test.ts` | Generator 新鲜证据绑定运行时身份和目标 SHA | evidence 尚未生成，ENOENT |
| Evaluator 摘要链 | `tests/fleet-validation-evidence.test.ts` | Evaluator 使用自己的身份并引用 Generator receipt 摘要 | evidence 尚未生成，ENOENT |
| Judge 最终裁决 | `tests/fleet-validation-evidence.test.ts` | Judge 使用自己的身份引用 Evaluator 摘要且裁决前未合并 | evidence 尚未生成，ENOENT |
| 失败闭合 | `tests/fleet-validation-evidence.test.ts` | 任一缺证或身份摘要漂移均不能判通过 | evidence 尚未生成，ENOENT |

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（Fleet 严格派发至 us-mac-m4）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped empty Postgres DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current role attempt}"
: "${HARNESS_PROVIDER:?Runner must inject provider}"
: "${HARNESS_ACCOUNT:?Runner must inject account}"
: "${HARNESS_MACHINE:?Runner must inject machine}"
: "${HARNESS_MODEL:?Runner must inject model}"
: "${HARNESS_RUNNER_DIGEST:?Runner must inject runner digest}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject capability snapshot}"
[ "$HARNESS_MACHINE" = us-mac-m4 ]
RUN_ID=5172f36e-d86c-45cf-a417-b2678c2ec3e4
BASE_SHA=676fed7de12023d355deac7849af8a525ae53f8d
TARGET_SHA=c305f6217da65bb69413c39e621b7e797e0fb189
SPRINT_DIR=sprints/08040600-kernel-pr1581-fleet-validation-r17
API_PORT=33187
BASE_URL="http://127.0.0.1:${API_PORT}"
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
WORKTREE_ROOT=$(mktemp -d)
WORKTREE="${WORKTREE_ROOT}/target"
API_PID=""
cleanup(){ set +e; [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null; rm -f "$COOKIE_A" "$COOKIE_B" /tmp/r17-*.json /tmp/r17-code-*; git worktree remove --force "$WORKTREE" 2>/dev/null; rmdir "$WORKTREE_ROOT" 2>/dev/null; }
trap cleanup EXIT
STARTED_AT=$(date -u +%FT%TZ)
START_EPOCH=$(date +%s)

HEAD_BEFORE=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)
[ "$HEAD_BEFORE" = "$TARGET_SHA" ]
gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '.state=="open" and .merged==false and .merged_at==null'
git cat-file -e "${BASE_SHA}^{commit}"
git fetch --no-tags origin refs/pull/1581/head
FETCHED_SHA=$(git rev-parse --verify 'FETCH_HEAD^{commit}')
[ "$FETCHED_SHA" = "$TARGET_SHA" ]
git worktree add --detach "$WORKTREE" "$FETCHED_SHA"
cd "$WORKTREE"
npm ci

export DATABASE_URL="$DB_URL"
export DATABASE_HOST="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')"
export DATABASE_PORT="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).port||"5432")')"
export DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))')"
export DATABASE_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')"
export DATABASE_PASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')"
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export BETTER_AUTH_URL="$BASE_URL"
npm run migrate --workspace apps/api
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL AND to_regclass('zenithjoy.tenant_members') IS NOT NULL" | grep -qx t
npm run build --workspace apps/api
PORT=$API_PORT npm start --workspace apps/api >/tmp/r17-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 60); do curl -sf "$BASE_URL/health" | jq -e '.status=="ok"' >/dev/null && break; [ "$i" -lt 60 ] || { tail -60 /tmp/r17-api.log; exit 1; }; sleep 1; done

EMAIL_A="r17-a-${RANDOM}-$(date +%s)@example.invalid"
EMAIL_B="r17-b-${RANDOM}-$(date +%s)@example.invalid"
curl -sfS -c "$COOKIE_A" -H 'content-type: application/json' -d "{\"name\":\"Harness A\",\"email\":\"$EMAIL_A\",\"password\":\"temporary-Aa1!\"}" "$BASE_URL/api/auth/sign-up/email" >/tmp/r17-signup-a.json
curl -sfS -c "$COOKIE_B" -H 'content-type: application/json' -d "{\"name\":\"Harness B\",\"email\":\"$EMAIL_B\",\"password\":\"temporary-Bb2!\"}" "$BASE_URL/api/auth/sign-up/email" >/tmp/r17-signup-b.json
USER_A=$(jq -er '.user.id' /tmp/r17-signup-a.json)
USER_B=$(jq -er '.user.id' /tmp/r17-signup-b.json)
[ "$USER_A" != "$USER_B" ]
TENANT_A=$(psql "$DB_URL" -v user_id="$USER_A" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'user_id'")
TENANT_B=$(psql "$DB_URL" -v user_id="$USER_B" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'user_id'")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ "$TENANT_A" != "$TENANT_B" ]

curl -sfS -b "$COOKIE_A" -X PUT -H 'content-type: application/json' -d '{"keywords_per_round_min":3,"keywords_per_round_max":10}' "$BASE_URL/api/acquisition/config" | jq -e '.success==true and [.data.keywords_per_round_min,.data.keywords_per_round_max]==[3,10]'
curl -sfS -b "$COOKIE_B" -X PUT -H 'content-type: application/json' -d '{"keywords_per_round_min":7,"keywords_per_round_max":9}' "$BASE_URL/api/acquisition/config" | jq -e '.success==true and [.data.keywords_per_round_min,.data.keywords_per_round_max]==[7,9]'
CODE=$(curl -sS -b "$COOKIE_A" -o /tmp/r17-invalid.json -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{"keywords_per_round_max":2}' "$BASE_URL/api/acquisition/config")
[ "$CODE" = 400 ]
jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' /tmp/r17-invalid.json
curl -sfS -b "$COOKIE_A" "$BASE_URL/api/acquisition/config" | jq -e '.success==true and [.data.keywords_per_round_min,.data.keywords_per_round_max]==[3,10]'
curl -sfS -b "$COOKIE_B" "$BASE_URL/api/acquisition/config" | jq -e '.success==true and [.data.keywords_per_round_min,.data.keywords_per_round_max]==[7,9]'
psql "$DB_URL" -v ta="$TENANT_A" -v tb="$TENANT_B" -tAc "SELECT (SELECT count(*)=1 FROM zenithjoy.acquisition_config WHERE tenant_id=:'ta' AND keywords_per_round_min=3 AND keywords_per_round_max=10 AND updated_at>NOW()-INTERVAL '5 minutes') AND (SELECT count(*)=1 FROM zenithjoy.acquisition_config WHERE tenant_id=:'tb' AND keywords_per_round_min=7 AND keywords_per_round_max=9 AND updated_at>NOW()-INTERVAL '5 minutes')" | grep -qx t

# 对同一租户真实并发提交两条单独看似合法、合并后冲突的 PATCH；不得串行伪装并发。
(curl -sS -b "$COOKIE_A" -o /tmp/r17-concurrent-min.json -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{"keywords_per_round_min":9}' "$BASE_URL/api/acquisition/config" > /tmp/r17-code-min) &
PID_MIN=$!
(curl -sS -b "$COOKIE_A" -o /tmp/r17-concurrent-max.json -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{"keywords_per_round_max":8}' "$BASE_URL/api/acquisition/config" > /tmp/r17-code-max) &
PID_MAX=$!
wait "$PID_MIN"
wait "$PID_MAX"
CODE_MIN=$(cat /tmp/r17-code-min)
CODE_MAX=$(cat /tmp/r17-code-max)
printf '%s\n%s\n' "$CODE_MIN" "$CODE_MAX" | sort -n | paste -sd, - | grep -qx '200,400'
if [ "$CODE_MIN" = 400 ]; then INVALID_BODY=/tmp/r17-concurrent-min.json; else INVALID_BODY=/tmp/r17-concurrent-max.json; fi
jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' "$INVALID_BODY"
CONCURRENT_FINAL=$(curl -sfS -b "$COOKIE_A" "$BASE_URL/api/acquisition/config")
echo "$CONCURRENT_FINAL" | jq -e '.success==true and (.data.keywords_per_round_min <= .data.keywords_per_round_max)'
CONCURRENT_MIN=$(echo "$CONCURRENT_FINAL" | jq -er '.data.keywords_per_round_min')
CONCURRENT_MAX=$(echo "$CONCURRENT_FINAL" | jq -er '.data.keywords_per_round_max')
psql "$DB_URL" -v ta="$TENANT_A" -v cmin="$CONCURRENT_MIN" -v cmax="$CONCURRENT_MAX" -tAc "SELECT count(*)=1 FROM zenithjoy.acquisition_config WHERE tenant_id=:'ta' AND keywords_per_round_min=:'cmin'::int AND keywords_per_round_max=:'cmax'::int AND keywords_per_round_min<=keywords_per_round_max AND updated_at>NOW()-INTERVAL '5 minutes'" | grep -qx t

HEAD_AFTER=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)
[ "$HEAD_AFTER" = "$TARGET_SHA" ]
gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '.state=="open" and .merged==false and .merged_at==null'
ELAPSED=$(( $(date +%s)-START_EPOCH ))
[ "$ELAPSED" -le 7200 ]
FINISHED_AT=$(date -u +%FT%TZ)
export STARTED_AT FINISHED_AT CODE_MIN CODE_MAX CONCURRENT_MIN CONCURRENT_MAX
mkdir -p "$OLDPWD/$SPRINT_DIR/evidence"
node - "$OLDPWD/$SPRINT_DIR/evidence/generator.json" <<'NODE'
const fs=require('fs');
const [out]=process.argv.slice(2);
const required=['HARNESS_ATTEMPT_ID','HARNESS_PROVIDER','HARNESS_ACCOUNT','HARNESS_MACHINE','HARNESS_MODEL','HARNESS_RUNNER_DIGEST','CAPABILITY_SNAPSHOT_ID'];
for(const k of required) if(!process.env[k]) throw new Error(`missing ${k}`);
const statuses=[Number(process.env.CODE_MIN),Number(process.env.CODE_MAX)].sort((a,b)=>a-b);
const data={schema_version:1,role:'generator',run_id:'5172f36e-d86c-45cf-a417-b2678c2ec3e4',attempt_id:process.env.HARNESS_ATTEMPT_ID,repository:'perfectuser21/zenithjoy-workspace',pr_number:1581,base_sha:'676fed7de12023d355deac7849af8a525ae53f8d',final_sha:'c305f6217da65bb69413c39e621b7e797e0fb189',provider:process.env.HARNESS_PROVIDER,account:process.env.HARNESS_ACCOUNT,machine:process.env.HARNESS_MACHINE,model:process.env.HARNESS_MODEL,runner_digest:process.env.HARNESS_RUNNER_DIGEST,capability_snapshot_id:process.env.CAPABILITY_SNAPSHOT_ID,started_at:process.env.STARTED_AT,finished_at:process.env.FINISHED_AT,product_validation:{exit_code:0,log_tail:'exact-SHA real-signup two-tenant concurrent effective-config validation passed',concurrent_effective_config:{response_statuses:statuses,final_min:Number(process.env.CONCURRENT_MIN),final_max:Number(process.env.CONCURRENT_MAX),invalid_error_code:'INVALID_CONFIG'}}};
fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
NODE
sha256sum "$OLDPWD/$SPRINT_DIR/evidence/generator.json" | awk '{print $1}' > "$OLDPWD/$SPRINT_DIR/evidence/generator.receipt.sha256"
echo "OK: Generator receipt created sha=$TARGET_SHA elapsed=${ELAPSED}s"
```

> Evaluator 必须用自己的 Runner 注入身份生成 `evaluator.json`，引用 `generator.receipt.sha256`；Judge 必须用自己的 Runner 注入身份生成 `judge.json`，引用 Evaluator 文件 SHA-256。三角色的 `attempt_id` 与 `capability_snapshot_id` 必须分别两两不相等；account 如实记录各 Runner 值而不强制不同。最终从合同分支运行失败测试验摘要链和 GitHub 未合并状态。
