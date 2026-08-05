# Sprint Contract Draft (Round 2)

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

本 Sprint 不新增 HTTP endpoint；验收器读取 Fleet 本轮 payload 与结果 JSON。成功结果的字面 schema 为：

```json
{"verdict":"PASS","failure_class":null,"failure_detail":null,"target":{"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d"},"evidence":{"github_pr_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","checked_commit_sha":"c305f6217da65bb69413c39e621b7e797e0fb189"}}
```

- `verdict` (string, 必填): 仅全部绑定检查通过时为 `PASS`。
- `failure_class` (string|null, 必填): 成功为 null；输入错误为 `payload_invalid` 或 `target_mismatch`；依赖错误为 `environment_failure`。
- `failure_detail` (object|null, 必填): 成功为 null；失败时精确记录 `dependency` 或 `field` 与非空 `reason`。
- `target` (object, 必填): 四个冻结目标字段逐字记录。
- `evidence` (object, 必填): GitHub PR head 与实际检出提交的完整 SHA。
- 完整性：顶层 keys 必须恰为 `["evidence","failure_class","failure_detail","target","verdict"]`。
- 禁用字段名：`repo`、`head_sha`、`anchor`、`workspace_head`（禁止同义替代或回退工作区 HEAD）。

错误结果保持同一顶层 schema，`verdict="FAIL"`，给出非空 `failure_class` 与 `failure_detail`。字段缺失/格式错为 `payload_invalid`，字段与冻结目标或 PR head 不一致为 `target_mismatch`，GitHub/Postgres 不可用为 `environment_failure`；不得产生成功结论。

## 已知约束（来自回归测试）

- [product-map/generated/product-map.json] → `line02/keyword_acquisition#step7` 存在且唯一。
- [.github/workflows/scripts/smoke/golden-path-2-smoke.sh] → Step 7 所属获客 Golden Path 的服务端 smoke 已登记。
- [累积FR] → context-manifest: unavailable（Brain 返回 404）。
- Registry 仅提供通用 Cecelia Harness API/DB/test 记录，未给 Fleet payload 专用 schema；PRD 字面优先。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 校验 Fleet payload 的 `base_repo`、`target_head_sha`、`gp_anchor`，并把 PASS 证据绑定 PR #1581 的同一 head SHA。 |
| NFR（做得多好） | 总预算 7200 秒；字段、GitHub PR head、检出 commit 任一不一致立即失败。 |
| Invariant（永不违反） | 不从标题、当前分支或工作区 HEAD 猜目标；失败不得降级为 PASS；验证身份只从 Runner 的 HARNESS_* / CAPABILITY_SNAPSHOT_ID late-bind。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 结论只对冻结 base SHA 与 payload target SHA 有效；PR head 改变即失效。 |
| 死亡告警（停了谁知道） | evaluator 非零退出并记录 `environment_failure`，Harness controller 在本 attempt 内可见。 |
| 失败语义（挂了怎么办） | fail-closed；输入错误、目标漂移、依赖故障分类分离，不重写目标。 |
| 效果确认（已发≠已生效） | PASS 同时要求 payload、GitHub PR head、git 检出 SHA、结果证据四方一致。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 当前 head 是否就是 payload 目标 | A. 当前工作区 HEAD；B. GitHub API `pulls/1581.head.sha` | B + 完整 40 位 SHA 精确比较 | PRD 明确禁止回退工作区 HEAD | 错提交被误报通过 |
| GP 锚点是否唯一有效 | A. 字符串正则；B. product-map SSOT 查询 line/id/step | B，且匹配数恰为 1 | 分类 SSOT 在 product-map | 验错 Golden Path 步骤 |

notes: judgment-pending-user: PR #1581 当前 head 是否就是 payload 目标（PrepPRD 以 ASSUMPTION 给出，未见独立拍板记录）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 三字段缺失/格式错 | FAIL / `payload_invalid` | 是 | 无，禁止猜测 |
| payload 与冻结目标或 PR head 不一致 | FAIL / `target_mismatch` | 是 | 无，禁止用 workspace HEAD |
| GitHub/git/Postgres 依赖不可用 | FAIL / `environment_failure` | 是 | 依赖恢复后重跑，不转业务 PASS |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness Initiative payload JSON | 不可信结构化输入 | 只解析固定 key、类型、完整 SHA 和 GP anchor，不执行字符串 | 未知 key 不参与目标判定；关键字段错即 fail-closed |

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步

[Harness Initiative payload] → [冻结字段校验] → [PR/commit/GP 三方核对] → [绑定证据的 PASS 或分类 FAIL]

### Step 1: 接收权威 payload
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 1 项。

**可观测行为**: 验收输入精确包含 `base_repo=perfectuser21/zenithjoy-workspace`、`target_head_sha=c305f6217da65bb69413c39e621b7e797e0fb189`、`gp_anchor=line02/keyword_acquisition#step7`。

**验证命令**:
```bash
jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' "$HARNESS_PAYLOAD_PATH"
```
**硬阈值**: 三字段全部存在且逐字相等；命令 exit 0。

### Step 2: 校验冻结基线、完整 SHA 与唯一 GP
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 2 项及边界情况。

**可观测行为**: base SHA 固定为 `676fed7de12023d355deac7849af8a525ae53f8d`，target 为 40 位 SHA，GP 在 SSOT 中唯一落到 step7。

**验证命令**:
```bash
jq -e '.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and (.target_head_sha|test("^[0-9a-f]{40}$"))' "$HARNESS_PAYLOAD_PATH"
jq '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | .steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json | grep -qx true
```
**硬阈值**: base SHA 精确相等、target 40 位、SSOT 唯一匹配数 1。

### Step 3: 绑定 PR head 与实际检出提交
**来源**: `[FROM_PRD]` — 「背景」及 NFR 版本要求。

**可观测行为**: GitHub PR #1581 head、payload target、Fleet 实际 checked commit 三者相等。

**验证命令**:
```bash
PR_HEAD=$(curl -fsS https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -er '.head.sha'); TARGET=$(jq -er '.target_head_sha' "$HARNESS_PAYLOAD_PATH"); CHECKED=$(jq -er '.evidence.checked_commit_sha' "$HARNESS_RESULT_PATH"); [ "$PR_HEAD" = "$TARGET" ] && [ "$CHECKED" = "$TARGET" ]
```
**硬阈值**: 三个值均为同一完整 SHA；GitHub 不可用即非零退出。

### Step 4: 输出可审计结论
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 3 项。

**可观测行为**: 成功结果完整记录目标；任一输入篡改或依赖故障只得 FAIL，不能出现 PASS。

**验证命令**:
```bash
node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$HARNESS_RESULT_PATH"
jq -e 'keys==["evidence","failure_class","failure_detail","target","verdict"] and .verdict=="PASS" and .failure_class==null and .failure_detail==null and .target.base_repo=="perfectuser21/zenithjoy-workspace" and .target.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .target.gp_anchor=="line02/keyword_acquisition#step7" and .target.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .evidence.github_pr_head_sha==.target.target_head_sha and .evidence.checked_commit_sha==.target.target_head_sha' "$HARNESS_RESULT_PATH"
```
**硬阈值**: verifier 与 jq 均 exit 0；顶层 keys 精确；所有 SHA 同值。

### Step 5: 负向篡改与依赖失败 fail-closed
**来源**: `[FROM_PRD]` — 「边界情况」四项。

**可观测行为**: 分别删除/篡改三个权威字段时生成准确 `payload_invalid`/`target_mismatch`；真实断开 GitHub 与 Postgres 时生成 `environment_failure`，均非零退出且不得输出 PASS。

**验证命令**:
```bash
bash -c 'set -euo pipefail; D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for C in '"'"'del(.base_repo)|payload_invalid|base_repo'"'"' '"'"'.target_head_sha="short"|payload_invalid|target_head_sha'"'"' '"'"'.gp_anchor="line02/keyword_acquisition#step6"|target_mismatch|gp_anchor'"'"'; do IFS="|" read -r E FC FIELD <<< "$C"; jq "$E" "$HARNESS_PAYLOAD_PATH" > "$D/p.json"; node scripts/harness/verify-fleet-target.mjs --payload "$D/p.json" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$D/o.json" && exit 1; jq -e --arg fc "$FC" --arg field "$FIELD" '"'"'.verdict=="FAIL" and .failure_class==$fc and .failure_detail.field==$field and (.failure_detail.reason|length>0)'"'"' "$D/o.json"; done; node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --github-api-base http://127.0.0.1:1 --output "$D/github.json" && exit 1; jq -e '"'"'.verdict=="FAIL" and .failure_class=="environment_failure" and .failure_detail.dependency=="github"'"'"' "$D/github.json"; node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url postgresql://127.0.0.1:1/unreachable --output "$D/postgres.json" && exit 1; jq -e '"'"'.verdict=="FAIL" and .failure_class=="environment_failure" and .failure_detail.dependency=="postgres"'"'"' "$D/postgres.json"'
```
**硬阈值**: 每个变体非零退出；每份失败 JSON 的 `verdict=FAIL`、分类与具体字段/依赖准确、reason 非空；总命令 exit 0。

## 真实调用方请求 shape

Fleet Worker 消费的生产同形输入是 Harness Initiative payload JSON，认证由 Fleet Runner 自身执行身份提供，不在 payload body 伪造：

- payload keys：`base_repo`、`target_head_sha`、`gp_anchor`、`base_sha`。
- 执行身份：运行时读取 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID`；合同不固定任何角色 UUID/snapshot。
- GitHub 请求：`GET /repos/perfectuser21/zenithjoy-workspace/pulls/1581`；公开 PR 无 body 认证字段。若 Runner 注入 `GITHUB_TOKEN`，仅用 `Authorization: Bearer` header。

## 禁 mock 边清单

- Fleet payload → 目标解析器（本单验证跨模块字段传递，测试必须读取真实 JSON，不 mock parser）。
- 目标解析器 → GitHub PR head / git commit 证据（必须真请求 GitHub、真比较完整 SHA，不 mock 外部结果）。
- 结论生成 → evidence JSON（必须真执行验证器并读取本轮文件）。

## 接缝清单

- [接缝×2] GitHub PR #1581 head：真调 GitHub API 两次；两次必须同为 payload SHA，否则 FLAKY/target_mismatch，未真验前为 `logic-done-pending`。
- Fleet 本轮检出提交：由结果 evidence 的 checked_commit_sha 与 payload、PR head 三方比较；真目标通过才 done。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${HARNESS_PAYLOAD_PATH:?Runner 必须提供本轮 Fleet payload JSON 路径}"
: "${HARNESS_RESULT_PATH:?Runner 必须提供本轮 Fleet 结果 JSON 路径}"
: "${DB_URL:?Fleet 必须注入本 attempt 的短期 Postgres URL}"
: "${HARNESS_ATTEMPT_ID:?}"
: "${HARNESS_PROVIDER:?}"
: "${HARNESS_ACCOUNT:?}"
: "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"
: "${CAPABILITY_SNAPSHOT_ID:?}"
SESSION_TMP=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r36-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$SESSION_TMP"' EXIT
jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"' "$HARNESS_PAYLOAD_PATH"
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc 'SELECT 1' | grep -qx 1
jq '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | .steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json | grep -qx true
for run in 1 2; do
  curl -fsS https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581 > "$SESSION_TMP/pr-$run.json"
  jq -er '.head.sha' "$SESSION_TMP/pr-$run.json" | grep -qx 'c305f6217da65bb69413c39e621b7e797e0fb189'
done
node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$SESSION_TMP/pass.json" | tee "$SESSION_TMP/verifier.log"
jq -e 'keys==["evidence","failure_class","failure_detail","target","verdict"] and .verdict=="PASS" and .failure_class==null and .failure_detail==null and .target=={"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d"} and .evidence.github_pr_head_sha==.target.target_head_sha and .evidence.checked_commit_sha==.target.target_head_sha' "$SESSION_TMP/pass.json"
for case in 'del(.base_repo)|payload_invalid|base_repo' '.base_repo="wrong/repo"|target_mismatch|base_repo' 'del(.target_head_sha)|payload_invalid|target_head_sha' '.target_head_sha="short"|payload_invalid|target_head_sha' 'del(.gp_anchor)|payload_invalid|gp_anchor' '.gp_anchor="line02/keyword_acquisition#step6"|target_mismatch|gp_anchor'; do
  IFS='|' read -r expr expected_class expected_field <<< "$case"
  jq "$expr" "$HARNESS_PAYLOAD_PATH" > "$SESSION_TMP/bad.json"
  if node scripts/harness/verify-fleet-target.mjs --payload "$SESSION_TMP/bad.json" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$SESSION_TMP/negative.json"; then exit 1; fi
  jq -e --arg fc "$expected_class" --arg field "$expected_field" '.verdict=="FAIL" and .failure_class==$fc and .failure_detail.field==$field and (.failure_detail.reason|length>0)' "$SESSION_TMP/negative.json"
done
if node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --github-api-base http://127.0.0.1:1 --output "$SESSION_TMP/github-fail.json"; then exit 1; fi
jq -e '.verdict=="FAIL" and .failure_class=="environment_failure" and .failure_detail.dependency=="github" and (.failure_detail.reason|length>0)' "$SESSION_TMP/github-fail.json"
if node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url postgresql://127.0.0.1:1/unreachable --output "$SESSION_TMP/postgres-fail.json"; then exit 1; fi
jq -e '.verdict=="FAIL" and .failure_class=="environment_failure" and .failure_detail.dependency=="postgres" and (.failure_detail.reason|length>0)' "$SESSION_TMP/postgres-fail.json"
printf 'PASS provider=%s account=%s machine=%s model=%s attempt=%s capability=%s\n' "$HARNESS_PROVIDER" "$HARNESS_ACCOUNT" "$HARNESS_MACHINE" "$HARNESS_MODEL" "$HARNESS_ATTEMPT_ID" "$CAPABILITY_SNAPSHOT_ID"
```

通过标准：7200 秒内脚本 exit 0；接缝两跑一致；日志保留当前 evaluator 的 late-bound provenance。失败标准：任一命令非零；不允许依赖不可用时降级 PASS。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: payload 三字段传 null、数组、大小写变化、非 40 位 SHA。
- 重复提交: 同一 payload 连续验证两次，证据应稳定且不污染结果。
- 中途中断: GitHub 请求中断、Postgres 拒绝连接或 result JSON 半写入，必须得到带 dependency/reason 的 environment_failure，不得 PASS。
- 边界值: GP anchor 增加空格/多余 suffix；SHA 40 位但不存在。
发现分级: P0/P1（错提交误报通过）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet payload 与证据绑定 | `sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-target-validation.test.ts` | 精确 payload 输出固定成功 schema；字段缺失与格式错误输出 payload_invalid；字段与冻结目标不一致输出 target_mismatch；GitHub 拒绝连接输出 environment_failure github；Postgres 拒绝连接输出 environment_failure postgres；拒绝 GP 锚点不存在 | verifier 尚未实现，输出文件缺失/断言失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- PostgreSQL 仅作为 Fleet 运行依赖做真实 `SELECT 1` 健康闭环；本 Sprint 不读取/写入业务表，因此无需 schema migration、用户或 tenant 自举。
- 本 Sprint 验证既有 Fleet 行为，不修改 PR #1581 的业务实现、不扩展其他 GP 步骤、不改变调度策略。
