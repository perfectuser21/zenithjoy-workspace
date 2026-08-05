---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: Brain 生产 payload → Fleet Worker bundle/checkout → GitHub/GP/DB 真实证据。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同不含 sprint-local Fleet Worker 代理实现
  Test: bash -c '! grep -R "fleet-worker-acceptance.mjs" sprints/08050200-kernel-pr1581-fleet-validation-r35/contract-*.md'

- [ ] [ARTIFACT] Generator 只改本 sprint 目录
  Test: bash -c ': "${HARNESS_WORKSPACE_START_SHA:?}"; git rev-parse --verify "${HARNESS_WORKSPACE_START_SHA}^{commit}" >/dev/null; test -z "$(git diff --name-only "$HARNESS_WORKSPACE_START_SHA"...HEAD | grep -v "^sprints/08050200-kernel-pr1581-fleet-validation-r35/" || true)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Fleet bundle 原样消费 Brain payload [接缝×2]
  动作: 连续两次真读 Brain task 和 Fleet Worker 生产 task bundle
  预期观察: execution_surface、repo、base、expected head、anchor 逐字段一致
  等待预算: 30s
  留证: 两次 jq 输出与 exit code
  Test: manual:bash -c 'P=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -ec .payload); for n in 1 2; do jq -e --arg repo "$(jq -r .base_repo <<<"$P")" --arg base "$(jq -r .base_sha <<<"$P")" --arg head "$(jq -r .target_head_sha <<<"$P")" --arg anchor "$(jq -r .gp_anchor <<<"$P")" '\'' .task_bundle.inputs.execution_surface=="fleet-worker" and .task_bundle.inputs.workspace_spec.repo==$repo and .task_bundle.inputs.workspace_spec.base_sha==$base and .task_bundle.inputs.workspace_spec.expected_head_sha==$head and .task_bundle.inputs.gp_anchor==$anchor '\'' "$HARNESS_TASK_BUNDLE_FILE"; done'

- [ ] [BEHAVIOR] [L2] B-02: 实际 checkout 绑定目标 PR head [接缝×2]
  动作: 真读 Brain target、当前 checkout 与 GitHub PR head
  预期观察: 三者精确等于同一完整 SHA，不回退隐含 HEAD
  等待预算: 30s
  留证: git 与 GitHub SHA 输出
  Test: manual:bash -c 'T=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -er .payload.target_head_sha); git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; git rev-parse --verify HEAD | grep -qx "$T"; for n in 1 2; do gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha | grep -qx "$T"; done'

- [ ] [BEHAVIOR] [L2] B-03: GP anchor 唯一解析到 step7
  动作: 从 Brain 与 Fleet bundle 取 anchor，再查 product-map SSOT
  预期观察: 两者均为 line02/keyword_acquisition#step7，SSOT 恰好命中一次
  等待预算: 0s
  留证: jq 输出
  Test: manual:bash -c 'A=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -er .payload.gp_anchor); test "$A" = line02/keyword_acquisition#step7; jq -e --arg a "$A" '\''.task_bundle.inputs.gp_anchor==$a'\'' "$HARNESS_TASK_BUNDLE_FILE"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json'

- [ ] [BEHAVIOR] [L2] B-04: 实际验收回执 schema 精确且绑定证据
  动作: 从合同提取并运行完整 E2E 验收进程，再读取它在全部生产检查结束后写出的真实 receipt
  预期观察: status=passed、failure_class=none、十个 key 精确存在且证据摘要为 64 位 hex
  等待预算: 0s
  留证: ${SPRINT_DIR}/evidence/${HARNESS_ATTEMPT_ID}/receipt.json 与 jq exit code
  Test: manual:bash -c 'X="${SPRINT_DIR}/evidence/${HARNESS_ATTEMPT_ID}/e2e-contract.sh"; mkdir -p "$(dirname "$X")"; awk '\''/^## E2E 验收/{found=1;next} found&&/^## /{exit} found&&/^```bash/{b=1;next} b&&/^```/{b=0;next} b{print}'\'' "$SPRINT_DIR/contract-draft.md" >"$X"; bash "$X" >"${X%.sh}.log"; R="${SPRINT_DIR}/evidence/${HARNESS_ATTEMPT_ID}/receipt.json"; jq -e '\''.status=="passed" and .failure_class=="none" and (.evidence_sha256|test("^[0-9a-f]{64}$")) and keys==["attempt_id","base_repo","base_sha","evidence_sha256","execution_surface","failure_class","gp_anchor","run_id","status","target_head_sha"] and (has("repo")|not) and (has("head_sha")|not) and (has("anchor")|not) and (has("ok")|not)'\'' "$R"'

- [ ] [BEHAVIOR] [L2] B-05: 生产 receipt 回归测试 fail-closed
  动作: 运行零 mock 测试，直接读取当前 Brain/bundle/git/GitHub
  预期观察: 四个生产 oracle 全绿；任一结构化字段缺失时失败
  等待预算: 60s
  留证: vitest verbose 输出与真实 exit code
  Test: manual:bash -c 'npx vitest run sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-production-receipt.test.ts --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: 七类错误输入输出完整稳定失败回执
  动作: 读取 E2E 验收进程对七个逐项篡改 payload 实际返回的非零 exit 与完整回执
  预期观察: 每行均含十个精确 key、status=failed、对应 failure_class、late-bound identity 和 64 位证据摘要，且无 passed
  等待预算: 0s
  留证: ${SPRINT_DIR}/evidence/${HARNESS_ATTEMPT_ID}/negative-matrix.jsonl
  Test: manual:bash -c 'F="${SPRINT_DIR}/evidence/${HARNESS_ATTEMPT_ID}/negative-matrix.jsonl"; test "$(wc -l < "$F" | tr -d " ")" -eq 7; jq -s -e '\''all(.[];.status=="failed" and (.evidence_sha256|test("^[0-9a-f]{64}$")) and keys==["attempt_id","base_repo","base_sha","evidence_sha256","execution_surface","failure_class","gp_anchor","run_id","status","target_head_sha"]) and ([.[].failure_class]|sort)==(["base_repo_mismatch","base_repo_missing","gp_anchor_invalid","gp_anchor_missing","target_head_sha_invalid","target_head_sha_mismatch","target_head_sha_missing"]|sort)'\'' "$F"'

- [ ] [BEHAVIOR] [L2] B-07: GitHub 可用但 PR head 不一致归输入失败
  动作: 让真实 GitHub 查询成功返回 PR head，再与 payload target_head_sha 精确比较
  预期观察: 查询命令失败才归 github_unavailable；查询成功但值不等归 target_head_sha_mismatch，绝不归环境失败
  等待预算: 30s
  留证: GitHub SHA 输出与 E2E failure_class
  Test: manual:bash -c 'F="${SPRINT_DIR}/evidence/${HARNESS_ATTEMPT_ID}/github-mismatch-receipt.json"; jq -e '\''.status=="failed" and .failure_class=="target_head_sha_mismatch" and (.evidence_sha256|test("^[0-9a-f]{64}$")) and keys==["attempt_id","base_repo","base_sha","evidence_sha256","execution_surface","failure_class","gp_anchor","run_id","status","target_head_sha"]'\'' "$F"'

## Invariant 映射

- INV-01（真实派发、strict ref、同义语义一致、真实 exit code）由 B-01/B-02/B-05 覆盖。
- INV-02（GP anchor、Test Contract 四列、secret/PII、共享 CI 禁区）由 B-03 与 ARTIFACT 条目覆盖。
- INV-03（verdict 锚定真实 SHA、identity late-bound、输入/依赖失败不假绿）由 B-02/B-04/B-05/B-06 覆盖。
- N/A：本 sprint 不新增服务、状态、表、job、API、租户、通知、RPA、UI、cron、部署、relay 或付费 API；其余 thin PRD 铁律不触及。
