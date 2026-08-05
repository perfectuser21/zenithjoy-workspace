---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 仅验证 payload 三字段消费及结论绑定冻结 target SHA。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness/verify-fleet-target.mjs` 提供 fail-closed CLI，且不读取当前 workspace HEAD 作为目标。
  Test: node -e "const fs=require('fs');const p='scripts/harness/verify-fleet-target.mjs';const c=fs.readFileSync(p,'utf8');if(!c.includes('target_head_sha')||!c.includes('gp_anchor')||c.includes('git rev-parse HEAD'))process.exit(1)"
- [ ] [ARTIFACT] 本轮结果含 evaluator late-bound provenance 与目标证据摘要，且不固化 proposer identity。
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('scripts/harness/verify-fleet-target.mjs','utf8');if(!c.includes('HARNESS_ATTEMPT_ID')||!c.includes('CAPABILITY_SNAPSHOT_ID'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 精确 payload 被接受并绑定冻结目标
  动作: 用 Runner 本轮 payload 与结果执行 Fleet 目标验证器
  预期观察: 输出 PASS，结果四个 target 字段与两个 evidence SHA 完全一致
  等待预算: 30s
  留证: verifier stdout 与 result JSON 摘要
  Test: manual:bash -c 'D=$(mktemp); trap '"'"'rm -f "$D"'"'"' EXIT; node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$D" && jq -e '"'"'keys==["evidence","failure_class","failure_detail","target","verdict"] and .verdict=="PASS" and .failure_class==null and .failure_detail==null and .target.target_head_sha==.evidence.github_pr_head_sha and .target.target_head_sha==.evidence.checked_commit_sha'"'"' "$D"'

- [ ] [BEHAVIOR] [L2] B-02: 目标仓库缺失或不一致时 fail-closed
  动作: 删除 base_repo，再改成 wrong/repo，分别执行验证器
  预期观察: 缺失得到 payload_invalid，不一致得到 target_mismatch，均指出 base_repo 且非零退出
  等待预算: 5s
  留证: 两次 stderr/exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for C in '"'"'del(.base_repo)|payload_invalid'"'"' '"'"'.base_repo="wrong/repo"|target_mismatch'"'"'; do IFS="|" read -r E FC <<< "$C"; jq "$E" "$HARNESS_PAYLOAD_PATH" > "$D/p.json"; node scripts/harness/verify-fleet-target.mjs --payload "$D/p.json" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$D/o.json" && exit 1; jq -e --arg fc "$FC" '"'"'.verdict=="FAIL" and .failure_class==$fc and .failure_detail.field=="base_repo" and (.failure_detail.reason|length>0)'"'"' "$D/o.json"; done'

- [ ] [BEHAVIOR] [L2] B-03: target SHA 缺失、短值或与 PR head 不一致时 fail-closed [接缝×2]
  动作: 真调 GitHub PR #1581 两次并对 payload SHA 做完整比较，再注入缺失/短 SHA
  预期观察: 真调两次 head 均等于冻结 SHA；非法 payload 两次均失败
  等待预算: 30s
  留证: 两次 GitHub `.head.sha` 与负向 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do curl -fsS https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '"'"'.head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189"'"'"'; done; for E in '"'"'del(.target_head_sha)'"'"' '"'"'.target_head_sha="short"'"'"'; do jq "$E" "$HARNESS_PAYLOAD_PATH" > "$D/p.json"; node scripts/harness/verify-fleet-target.mjs --payload "$D/p.json" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$D/o.json" && exit 1; jq -e '"'"'.verdict=="FAIL" and .failure_class=="payload_invalid" and .failure_detail.field=="target_head_sha"'"'"' "$D/o.json"; done'

- [ ] [BEHAVIOR] [L2] B-04: GP anchor 缺失、漂移或 SSOT 不存在时 fail-closed
  动作: 校验 step7 在 product-map 唯一存在，再删除锚或改成 step6
  预期观察: SSOT 匹配数为 1；两个篡改变体均失败且不猜测其他 Step
  等待预算: 5s
  留证: jq 唯一性输出与负向 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; jq '"'"'[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1'"'"' product-map/generated/product-map.json | grep -qx true; for C in '"'"'del(.gp_anchor)|payload_invalid'"'"' '"'"'.gp_anchor="line02/keyword_acquisition#step6"|target_mismatch'"'"'; do IFS="|" read -r E FC <<< "$C"; jq "$E" "$HARNESS_PAYLOAD_PATH" > "$D/p.json"; node scripts/harness/verify-fleet-target.mjs --payload "$D/p.json" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --output "$D/o.json" && exit 1; jq -e --arg fc "$FC" '"'"'.verdict=="FAIL" and .failure_class==$fc and .failure_detail.field=="gp_anchor"'"'"' "$D/o.json"; done'

- [ ] [BEHAVIOR] [L2] B-05: 结果 schema 完整且禁用同义字段不存在
  动作: 对本轮 Fleet result 执行完整 keys、类型与禁用字段反向断言
  预期观察: 顶层 keys 精确，target/evidence 结构完整，无 repo/head_sha/anchor/workspace_head
  等待预算: 0s
  留证: jq exit code 与 result JSON 摘要
  Test: manual:bash -c 'jq -e '"'"'keys==["evidence","failure_class","failure_detail","target","verdict"] and (.verdict|type=="string") and (.target|keys==["base_repo","base_sha","gp_anchor","target_head_sha"]) and (.evidence|keys==["checked_commit_sha","github_pr_head_sha"]) and (has("repo")|not) and (has("head_sha")|not) and (has("anchor")|not) and (has("workspace_head")|not)'"'"' "$HARNESS_RESULT_PATH"'

- [ ] [BEHAVIOR] [L2] B-06: GitHub 依赖不可用时准确分类 [接缝×2]
  动作: 将 GitHub API base 指向本机拒绝连接端口并执行真实请求两次
  预期观察: 两次均非零退出，结果均为 environment_failure 且 dependency=github
  等待预算: 10s
  留证: 两次失败 JSON 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url "$DB_URL" --github-api-base http://127.0.0.1:1 --output "$D/o-$N.json" && exit 1; jq -e '"'"'.verdict=="FAIL" and .failure_class=="environment_failure" and .failure_detail.dependency=="github" and (.failure_detail.reason|length>0)'"'"' "$D/o-$N.json"; done'

- [ ] [BEHAVIOR] [L2] B-07: Postgres 依赖不可用时准确分类 [接缝×2]
  动作: 将 DB URL 指向本机拒绝连接端口并执行真实连接两次
  预期观察: 两次均非零退出，结果均为 environment_failure 且 dependency=postgres
  等待预算: 10s
  留证: 两次失败 JSON 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do node scripts/harness/verify-fleet-target.mjs --payload "$HARNESS_PAYLOAD_PATH" --result "$HARNESS_RESULT_PATH" --product-map product-map/generated/product-map.json --pr 1581 --db-url postgresql://127.0.0.1:1/unreachable --output "$D/o-$N.json" && exit 1; jq -e '"'"'.verdict=="FAIL" and .failure_class=="environment_failure" and .failure_detail.dependency=="postgres" and (.failure_detail.reason|length>0)'"'"' "$D/o-$N.json"; done'

- [ ] [BEHAVIOR] [L2] INV-1: 本 Sprint 不创建用户域 LaunchAgent
  动作: 检查候选变更列表
  预期观察: 无 `Library/LaunchAgents` 或 `infrastructure/launchagents` 新常驻服务
  等待预算: 0s
  留证: git diff name-only
  Test: manual:bash -c 'if git diff --name-only fd6bc889beaca3cd045080d408d37e3c5a2bcb48...HEAD | grep -qE '"'"'(^|/)Library/LaunchAgents|^infrastructure/launchagents/'"'"'; then exit 1; fi'

## Invariant 映射

- 本机 LaunchAgent 铁律 → INV-1。
- status 枚举、新共享 CI、DB 表/job/cron/租户/PII/Android/UIA/部署/常驻服务等铁律 → N/A：本 Sprint 只新增隔离验证器与合同测试，不改变这些模块。
- 同一语义在判变与终验一致、ref 用 `--verify`、PR head SHA 绑定、临时脚本独享路径、接缝真验、secret 不落日志、manual oracle 真 exit code、target_environment payload 路由 → 已由 B-01 至 B-05 与 E2E fail-closed 脚本覆盖。
- Test Contract 固定四列且 testFile backtick → contract-draft 的 Test Contract 已遵守。
- 共享 CI 基础设施默认禁区 → task-plan files 未授权 `.github/workflows` 与 smoke allowlist。
- smoke 铁律（重复项）→ product-map smoke 文件只读核验，不修改。
