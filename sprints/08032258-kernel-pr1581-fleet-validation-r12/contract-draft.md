# Sprint Contract Draft (Round 2)

## Notes

- 本合同只验证 PR #1581 精确 SHA，不修改产品实现、不自动合并、不读取或复制其他候选、不修改共享 Red fixture。
- contract-gate: skipped (file not found, third-party repo)
- Registry 可达；未发现本验证任务专属 HTTP schema。context-manifest: unavailable（404 HTML）。
- `npm run product-map:check` 首次因 workspace 未安装锁定依赖 `ajv` 未启动；此环境问题不得当作 PASS，安装依赖后必须重跑。
- 当前 proposer 的 capability snapshot 为 `4cdde921-5a24-458a-9a78-8d03e3c16e60`，但冻结 PRD 要求最终产品验证证据使用 `cc3550be-875a-48d3-9be4-24343fb355a9`；前者只证明本轮合同起草的执行面，不能冒充后者。
- Round 2 统一控制面身份为 run `bfaf1e49-a8cb-401e-9fc3-d6c62c457edc` / attempt `ebb6a784-ff4b-425b-ba08-d5d8625e2736`；产品 E2E、Evaluator、Judge 与 merge gate 均须绑定该身份。
- 产品 E2E 只产出产品验证原始结果；Evaluator、Independent Judge 与 merge gate 由各自后续角色生成，禁止产品脚本预造裁决，也禁止在 Judge 尚未运行时循环读取 Judge 结果。
- GP 使用 `keep-green`：本 Sprint 验证既有 step7 对应改动，不新增业务行为；推进型 `#step7` 会要求修改共享 smoke 文件，与冻结 PRD 范围相冲突。

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 不新增 HTTP 响应；证据 JSON 字段由下方 Golden Path 与失败测试逐字锁定。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`。
- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → 真 Postgres 下非法有效态、合法更新、并发串行与双租户隔离。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（404 HTML）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 对 PR #1581 精确 SHA 在获准 US M4 跑新鲜 provider-neutral 全链，收集独立双裁决后只开放人工合并确认。 |
| NFR（做得多好） | 性能/可靠性 | 总预算 7200s；严格 affinity、runner digest、能力快照均逐字匹配；任何缺证或漂移 fail-closed。 |
| Invariant（永不违反） | 安全/一致性 | 不复用旧证据、不改共享 Red fixture、不读其他候选、不自动合并；所有证据绑定同一 run/attempt/final SHA。 |
| 判定点（怎么知道） | 模糊现实判断 | 见判定点登记表。 |
| 保质期（何时过期） | 退役责任 | PR head 一旦变化，四份证据立即过期，必须对新 SHA 重跑。 |
| 死亡告警（停了谁知道） | 故障发现 | pipeline/runner/bridge/callback/GAN 非通过即保留 log_tail 并阻断 merge gate。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | 全部 fail-closed；保留真实失败，禁止 fallback 或旧证据补位。 |
| 效果确认（已发≠已生效） | 生效回执 | 真产品测试 exit 0、Evaluator PASS、Judge PASS、同 SHA 与 merge_performed=false 四重确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR head 是否仍为目标提交 | A. 本地 ref；B. GitHub PR API 当前 head | B. GitHub PR API | 防本地旧 ref 掩盖远端漂移 | 把旧代码误判为可合并 |
| ⚠️ 双裁决是否新鲜且独立 | A. 看结论文本；B. 校验 run/attempt/SHA/时间/evidence_id/结构 | B. 全字段校验 | 冻结 PRD 明确禁止复用 | 旧证据或单一裁决假绿 |
| 严格 affinity 是否满足 | A. 机器标签；B. execution evidence 的机器/provider/account/model/snapshot/digest | B. 全字段一致 | 标签本身不足以证明实际执行面 | fallback 机器结果冒充 |

judgment-pending-user: PR head 是否仍为目标提交
judgment-pending-user: 双裁决是否新鲜且独立

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| PR SHA 漂移 | 当前 attempt 作废，记录 observed SHA | 是，改为新 SHA 后全量重跑 | 禁止复用已有 verdict |
| affinity/snapshot/digest 不符 | 非零退出并保留实际字段 | 是，在合规机器重派 | 禁止 fallback |
| runner/bridge/callback/GAN 中断 | 记录真实 failure_class/log_tail | 是，新 attempt 从头跑 | 禁止旧证据补齐 |
| 任一裁决缺失/非 PASS/结构不全 | merge gate 保持关闭 | 是，独立重跑缺失角色 | 禁止人工绕过证据闸 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或用户输入接口。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

## 真实调用方请求 shape

N/A — 本 Sprint 不新增设备/agent 到服务端请求；产品验证沿用 PR #1581 已有生产路由与真实 signup/session-cookie 请求，不引入第二种认证 shape。

## 禁 mock 边清单

- PR head ↔ GitHub PR #1581：必须查询真实远端 PR head，禁止本地常量代替 observed SHA。
- acquisition PUT/PATCH 路由 ↔ service ↔ Postgres：必须在 attempt 空库迁移后启动真实 API，以 signup 产生的真实 session cookie 调用，禁止 mock 路由、service、pool 或 transaction client。
- fleet dispatcher ↔ runner execution evidence：必须来自本 attempt 的 `us-mac-m4` 实际运行记录。
- Evaluator/Judge ↔ merge gate：必须使用两份不同 evidence_id 的真实裁决文件，禁止合成或复制。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] GitHub PR head ↔ exact-SHA worktree：执行前后各查一次，任一次漂移立即作废。
- [接缝×2] 真 Postgres ↔ production auth/router/service：空库 migration、signup、cookie、并发 effective-config 测试均使用同一 `DB_URL`；真验前为 `logic-done-pending`。
- [接缝×2] fleet runner ↔ Evaluator ↔ Independent Judge ↔ merge gate：两次执行不一致判 FLAKY；真验前为 `logic-done-pending`。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[锁定 PR 与执行面] → [新鲜真链验证 effective-config] → [独立双裁决绑定最终 SHA] → [只开放人工确认]

### Step 1: 锁定目标仓库、PR、机器和精确 SHA
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: GitHub PR 当前 head、fleet 实际机器、provider/account/model、能力快照与 runner digest 全部逐字匹配；否则停止。

**验证命令**: `H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha) && [ "$H" = c305f6217da65bb69413c39e621b7e797e0fb189 ] && jq -e --arg h "$H" '.run_id=="bfaf1e49-a8cb-401e-9fc3-d6c62c457edc" and .attempt_id=="ebb6a784-ff4b-425b-ba08-d5d8625e2736" and .repository=="perfectuser21/zenithjoy-workspace" and .pr_number==1581 and .machine=="us-mac-m4" and .final_sha==$h and .provider=="codex" and .account=="team2" and .model=="gpt-5.6-sol" and .capability_snapshot_id=="cc3550be-875a-48d3-9be4-24343fb355a9" and .runner_digest=="sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a"' "$SPRINT_DIR/evidence/fleet-run.json"`

**硬阈值**: observed head 与 final_sha 均精确相等；所有 affinity 字段精确相等，命令 exit 0。

### Step 2: 本 attempt 新鲜全链验证产品有效配置保护
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及「范围限定」。

**可观测行为**: 同一 attempt 空库完成真实 migration/signup/session-cookie 后，PR #1581 的产品回归与真实 API 验证通过；不读取 r11 verdict。

**验证命令**: `jq -e '.run_id=="bfaf1e49-a8cb-401e-9fc3-d6c62c457edc" and .attempt_id=="ebb6a784-ff4b-425b-ba08-d5d8625e2736" and .pipeline_status=="passed" and .product_validation.exit_code==0 and .product_validation.final_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and (.product_validation.log_tail|type=="string" and length>0) and ((.finished_at|fromdateiso8601)-(.started_at|fromdateiso8601)<=7200)' "$SPRINT_DIR/evidence/fleet-run.json"`

**硬阈值**: product_validation exit_code=0；run/attempt 精确匹配；总执行时间 ≤7200s。

### Step 3: Evaluator 与 Independent Judge 形成独立双证据
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步。

**可观测行为**: 两份证据均结构完整、PASS、新鲜、绑定相同 run/attempt/final SHA；Judge 的 `evaluated_evidence_id/evaluated_sha` 必须精确引用 Evaluator，且两份自身 `evidence_id` 不同。

**验证命令**: `npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts -t 'Evaluator|Independent Judge' --reporter=verbose`

**硬阈值**: 2/2 pass；Evaluator issued_at 不早于产品 finished_at，Judge issued_at 不早于 Evaluator；每份顶层 exit_code=0、behavior_tests 非空且逐项含 exit_code=0、非空 log_tail、verification_level 与 evidence。

### Step 4: 双证据齐备后仍保持人工合并确认门
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步。

**可观测行为**: merge gate 精确引用本轮实际 Evaluator/Judge evidence_id，只标记 eligible_for_human_confirmation=true，同时 human_confirmation_required=true、merge_performed=false。

**验证命令**: `npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts -t '双裁决齐备后仍只开放人工确认而未自动合并' --reporter=verbose`

**硬阈值**: 命令 exit 0；不得出现自动 merge 副作用。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 篡改任一 evidence 的 run_id、attempt_id、SHA、role、exit_code 或 behavior_tests 结构。
- 重复提交: 重放同一 evaluator evidence 作为 judge，确认 evidence_id/role 独立性闸拒绝。
- 中途中断: 在产品验证后、Judge 前中断，确认 merge gate 仍关闭且失败原因保留。
- 边界值: PR head 在两次远端查询之间变化；issued_at 恰等于 run.started_at；执行耗时恰为 7200s。
发现分级: P0/P1（错误 SHA 被放行、旧证据复用、自动合并）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fleet 入口锁定 | `tests/fleet-validation-evidence.test.ts` | 入口证据锁定仓库 PR 机器和精确最终 SHA | evidence 尚未生成，ENOENT |
| Evaluator 新鲜证据 | `tests/fleet-validation-evidence.test.ts` | Evaluator 新鲜 PASS 证据绑定本 attempt 和最终 SHA | evidence 尚未生成，ENOENT |
| Judge 独立证据 | `tests/fleet-validation-evidence.test.ts` | Independent Judge 新鲜独立 PASS 证据绑定 Evaluator 和最终 SHA | evidence 尚未生成，ENOENT |
| 人工确认门 | `tests/fleet-validation-evidence.test.ts` | 双裁决齐备后仍只开放人工确认而未自动合并 | evidence 尚未生成，ENOENT |

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（Fleet 将本脚本严格派发至 us-mac-m4；执行身份由控制面生成的 fleet-run 证据核验，不要求操作员注入业务身份）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped empty Postgres DB_URL}"
TARGET_SHA=c305f6217da65bb69413c39e621b7e797e0fb189
API_PORT=33181
BASE_URL="http://127.0.0.1:${API_PORT}"
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
WORKTREE_ROOT=$(mktemp -d)
WORKTREE="${WORKTREE_ROOT}/target"
API_PID=""
cleanup(){ set +e; [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null; rm -f "$COOKIE_A" "$COOKIE_B" /tmp/r12-*.json /tmp/r12-code-*; git worktree remove --force "$WORKTREE" 2>/dev/null; rmdir "$WORKTREE_ROOT" 2>/dev/null; }
trap cleanup EXIT
START_EPOCH=$(date +%s)

HEAD_BEFORE=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)
[ "$HEAD_BEFORE" = "$TARGET_SHA" ] || { echo "FAIL: PR head drifted observed=$HEAD_BEFORE"; exit 1; }
git fetch --no-tags origin refs/pull/1581/head
FETCHED_SHA=$(git rev-parse --verify 'FETCH_HEAD^{commit}')
[ "$FETCHED_SHA" = "$TARGET_SHA" ] || { echo "FAIL: fetched PR head mismatch observed=$FETCHED_SHA"; exit 1; }
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
PORT=$API_PORT npm start --workspace apps/api >/tmp/r12-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 60); do curl -sf "$BASE_URL/health" | jq -e '.status=="ok"' >/dev/null && break; [ "$i" -lt 60 ] || { tail -60 /tmp/r12-api.log; exit 1; }; sleep 1; done

EMAIL_A="r12-a-${RANDOM}-$(date +%s)@example.invalid"
EMAIL_B="r12-b-${RANDOM}-$(date +%s)@example.invalid"
curl -sfS -c "$COOKIE_A" -H 'content-type: application/json' -d "{\"name\":\"Harness A\",\"email\":\"$EMAIL_A\",\"password\":\"temporary-Aa1!\"}" "$BASE_URL/api/auth/sign-up/email" >/tmp/r12-signup-a.json
curl -sfS -c "$COOKIE_B" -H 'content-type: application/json' -d "{\"name\":\"Harness B\",\"email\":\"$EMAIL_B\",\"password\":\"temporary-Bb2!\"}" "$BASE_URL/api/auth/sign-up/email" >/tmp/r12-signup-b.json
USER_A=$(jq -er '.user.id' /tmp/r12-signup-a.json)
USER_B=$(jq -er '.user.id' /tmp/r12-signup-b.json)
[ "$USER_A" != "$USER_B" ]
TENANT_A=$(psql "$DB_URL" -v user_id="$USER_A" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'user_id'")
TENANT_B=$(psql "$DB_URL" -v user_id="$USER_B" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'user_id'")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ "$TENANT_A" != "$TENANT_B" ]

curl -sfS -b "$COOKIE_A" -X PUT -H 'content-type: application/json' -d '{"keywords_per_round_min":3,"keywords_per_round_max":10}' "$BASE_URL/api/acquisition/config" | jq -e '.success==true and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==10'
curl -sfS -b "$COOKIE_B" -X PUT -H 'content-type: application/json' -d '{"keywords_per_round_min":7,"keywords_per_round_max":9}' "$BASE_URL/api/acquisition/config" | jq -e '.success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==9'

CODE=$(curl -sS -b "$COOKIE_A" -o /tmp/r12-invalid.json -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{"keywords_per_round_max":2}' "$BASE_URL/api/acquisition/config")
[ "$CODE" = 400 ]
jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' /tmp/r12-invalid.json
curl -sfS -b "$COOKIE_A" "$BASE_URL/api/acquisition/config" | jq -e '.success==true and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==10'
curl -sfS -b "$COOKIE_B" "$BASE_URL/api/acquisition/config" | jq -e '.success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==9'

curl -sS -b "$COOKIE_A" -o /tmp/r12-concurrent-min.json -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{"keywords_per_round_min":9}' "$BASE_URL/api/acquisition/config" >/tmp/r12-code-min &
P1=$!
curl -sS -b "$COOKIE_A" -o /tmp/r12-concurrent-max.json -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{"keywords_per_round_max":8}' "$BASE_URL/api/acquisition/config" >/tmp/r12-code-max &
P2=$!
wait "$P1"
wait "$P2"
[ "$(sort /tmp/r12-code-min /tmp/r12-code-max | paste -sd, -)" = "200,400" ]
jq -s -e 'map(.success)|sort == [false,true]' /tmp/r12-concurrent-min.json /tmp/r12-concurrent-max.json
jq -s -e 'map(select(.success==false and .error.code=="INVALID_CONFIG"))|length==1' /tmp/r12-concurrent-min.json /tmp/r12-concurrent-max.json
curl -sfS -b "$COOKIE_A" "$BASE_URL/api/acquisition/config" >/tmp/r12-final-a.json
curl -sfS -b "$COOKIE_B" "$BASE_URL/api/acquisition/config" >/tmp/r12-final-b.json
jq -e '.success==true and (.data.keywords_per_round_min<=.data.keywords_per_round_max) and (([.data.keywords_per_round_min,.data.keywords_per_round_max]==[9,10]) or ([.data.keywords_per_round_min,.data.keywords_per_round_max]==[3,8]))' /tmp/r12-final-a.json
jq -e '.success==true and [.data.keywords_per_round_min,.data.keywords_per_round_max]==[7,9]' /tmp/r12-final-b.json
psql "$DB_URL" -v ta="$TENANT_A" -v tb="$TENANT_B" -tAc "SELECT (SELECT count(*)=1 FROM zenithjoy.acquisition_config WHERE tenant_id=:'ta' AND keywords_per_round_min<=keywords_per_round_max AND updated_at>NOW()-INTERVAL '5 minutes') AND (SELECT count(*)=1 FROM zenithjoy.acquisition_config WHERE tenant_id=:'tb' AND keywords_per_round_min=7 AND keywords_per_round_max=9 AND updated_at>NOW()-INTERVAL '5 minutes')" | grep -qx t

HEAD_AFTER=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)
[ "$HEAD_AFTER" = "$TARGET_SHA" ] || { echo "FAIL: PR head drifted during run observed=$HEAD_AFTER"; exit 1; }
ELAPSED=$(( $(date +%s)-START_EPOCH ))
[ "$ELAPSED" -le 7200 ]
echo "OK: exact-SHA real-signup two-tenant effective-config validation passed sha=$TARGET_SHA elapsed=${ELAPSED}s"
```

> 后续收证顺序（不可并行伪造）：Fleet wrapper 先据本脚本真实 exit code 写 fleet-run.json；Evaluator 再写 evaluator.json；Independent Judge 读取并引用 Evaluator 后写 independent-judge.json；控制面最后写 merge-gate.json。四份证据齐备后，从 proposer 合同分支运行 npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts --reporter=verbose，不得在精确 SHA 产品 worktree 内寻找本轮合同测试。
