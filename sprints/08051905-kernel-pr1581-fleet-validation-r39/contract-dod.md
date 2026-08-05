---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

## ARTIFACT 条目

- [ ] [ARTIFACT] `fleet-bundle-verifier.mjs` 只读 Runner 的真实 task bundle，输出摘要绑定结论；不得创建或修改 bundle。
  Test: node -e "const fs=require('fs');const p='sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-bundle-verifier.mjs';const c=fs.readFileSync(p,'utf8');if(!c.includes('HARNESS_TASK_BUNDLE_FILE')||c.includes('writeFileSync'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Worker 原始 bundle 证明真实入口已绑定 target [接缝×2]
  动作: 读取 Runner 注入的真实 task bundle，并与实际 checkout HEAD 对账
  预期观察: 三个 payload 字段、worker 执行面、checkout target 与当前 Runner 身份一致
  等待预算: 5s
  留证: bundle SHA-256、git HEAD 与 JSON 输出
  Test: manual:bash -c 'test -r "$HARNESS_TASK_BUNDLE_FILE" && test "$(jq -r .task_bundle.inputs.workspace_spec.expected_head_sha "$HARNESS_TASK_BUNDLE_FILE")" = "$(git rev-parse --verify HEAD^{commit})" && jq -e '"'"'.task_bundle.execution_surface=="fleet-worker" and .task_bundle.inputs.workspace_spec.base_repo=="perfectuser21/zenithjoy-workspace" and .task_bundle.inputs.workspace_spec.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .task_bundle.inputs.workspace_spec.gp_anchor=="line02/keyword_acquisition#step7"'"'"' "$HARNESS_TASK_BUNDLE_FILE"'

- [ ] [BEHAVIOR] [L2] B-02: 成功结论 keys 与 receipt 摘要完整
  动作: 将 Worker 实际 task bundle 交给只读 verifier
  预期观察: `ok:true`、七个精确 keys，receipt_sha256 等于文件真实摘要
  等待预算: 5s
  留证: verifier stdout 与 sha256sum
  Test: manual:bash -c 'P="$HARNESS_TASK_BUNDLE_FILE"; O=$(node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-bundle-verifier.mjs "$P"); D=$(sha256sum "$P" | awk '"'"'{print $1}'"'"'); echo "$O" | jq -e --arg d "$D" '"'"'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","receipt_sha256","target_head_sha"] and .ok==true and .failure_class==null and .receipt_sha256==$d'"'"''

- [ ] [BEHAVIOR] [L2] B-03: 三字段缺失、错值与格式异常全部拒绝
  动作: Node 内建测试 runner 对 bundle 逐项变异
  预期观察: 七个 case 均进入行为断言并得到 payload_invalid，不读取工作区兜底
  等待预算: 10s
  留证: TAP 中七个测试名、exit code 与失败分类
  Test: manual:bash -c 'node --test sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/fleet-bundle-verifier.test.mjs'

- [ ] [BEHAVIOR] [L2] B-04: 冻结 base、checkout 与 GitHub PR head 同目标 [接缝×2]
  动作: 真查 Git object graph、当前 checkout 与 GitHub PR #1581
  预期观察: base 是 target 祖先；checkout、bundle expected_head 与 GitHub head 均为指定 target
  等待预算: 30s
  留证: rev-parse、merge-base、gh JSON 输出
  Test: manual:bash -c 'T=c305f6217da65bb69413c39e621b7e797e0fb189; test "$(git rev-parse --verify HEAD^{commit})" = "$T" && test "$(jq -r .task_bundle.inputs.workspace_spec.expected_head_sha "$HARNESS_TASK_BUNDLE_FILE")" = "$T" && git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null && git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d "$T" && gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid | jq -e '"'"'.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"'"'"''

- [ ] [BEHAVIOR] [L2] B-05: attempt 空库完成真实 schema bootstrap
  动作: 在同一 Fleet `DB_URL` 执行 apps/api 仓库 migration
  预期观察: migration 非零即失败；`zenithjoy.schema_migrations` 真表存在且至少一条本轮 migration
  等待预算: 120s
  留证: migration log 与 psql 查询结果
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" npm run migrate --workspace=apps/api >/tmp/fleet-migrate-"$HARNESS_ATTEMPT_ID".log && psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM zenithjoy.schema_migrations" | awk '"'"'$1>=1{ok=1} END{exit !ok}'"'"''

- [ ] [BEHAVIOR] [L2] B-06: bundle 或依赖不可用不得产生成功结论
  动作: 对不存在 bundle 路径执行 verifier，并对不可达 Postgres 执行 migration
  预期观察: 两次均非零；bundle 路径分类 environment_failure，绝无 ok:true
  等待预算: 10s
  留证: 两个真实 exit code与失败 JSON
  Test: manual:bash -c 'D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-fail-${HARNESS_ATTEMPT_ID}.XXXXXX"); trap '"'"'rm -rf "$D"'"'"' EXIT; if node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-bundle-verifier.mjs "$D/missing.json" >"$D/out" 2>&1; then exit 1; fi; jq -e '"'"'.ok==false and .failure_class=="environment_failure" and .ok!=true'"'"' "$D/out"; if DATABASE_URL="postgresql://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1" npm run migrate --workspace=apps/api >"$D/db" 2>&1; then exit 1; fi'

## Invariant 覆盖

- INV-01 常驻服务/RPA/UI/job/cron/租户/新 API：N/A，本 sprint 不触及。
- INV-02 status 枚举：N/A，不新增状态；不硬编码新状态。
- INV-03 共享 CI 禁区：不修改 workflow 或 smoke allowlist。
- INV-04 SHA 同义处理：bundle、checkout、GitHub 与结论使用同一 target；冻结 base 只验祖先。
- INV-05 Test Contract：固定四列、testFile 使用反引号。
- INV-06 git ref：全部使用 `rev-parse --verify "<ref>^{commit}"`。
- INV-07 真接缝/提前 merge：PR head、checkout 与 bundle 精确对账后才可成功。
- INV-08 临时文件：E2E 路径含 late-bound attempt ID 并 trap 清理。
- INV-09 失败语义：bundle/依赖失败非零，不 warning 降级。
- INV-10 secrets/PII：不打印 token、凭据或业务数据。
- INV-11 DB：写入侧与校验侧只用同一 `DB_URL`；先跑真实 migration。
- INV-12 validation identity：使用 Runner 注入值，不固化 proposer/reviewer UUID 或 snapshot。
- INV-13 单 slot/merge 权：task-plan 仅 ws1；Generator 只推 branch，不 merge。
- INV-14 manual oracle：Node test runner 真启动并记录 exit code；不用 Vitest/Rollup 启动失败冒充 RED。
- INV-15 其余冻结铁律：与本次纯验收路径无交集，显式 N/A。
