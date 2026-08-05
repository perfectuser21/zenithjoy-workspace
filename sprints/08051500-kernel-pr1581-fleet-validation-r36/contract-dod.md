---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 仅新增本 Sprint 的可执行验收脚本、测试与合同；不修改 PR #1581、生产 Worker、migration 或 Harness 调度。

## ARTIFACT 条目

- [ ] [ARTIFACT] Sprint 验收执行体存在且仅消费固定 payload keys
  Test: node -e "const c=require('fs').readFileSync('sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs','utf8');if(!c.includes('target_head_sha'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 经四项真实对账后通过 [接缝×2]
  动作: 对同一真实 bundle 连续执行验收脚本两次
  预期观察: 两次均 passed，且 repo/base/head/anchor 完全一致
  等待预算: 120s
  留证: 两份 JSON 与 SHA-256
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; for N in 1 2; do node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/$N.json"; jq -e '\''.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'\'' "$D/$N.json"; done; cmp "$D/1.json" "$D/2.json"'

- [ ] [BEHAVIOR] [L2] B-02: 权威字段缺失均 fail-closed
  动作: 逐一删除 base_repo、target_head_sha、gp_anchor 后执行
  预期观察: 每次非零，JSON 点名对应 failed_field
  等待预算: 30s
  留证: 三份失败 JSON 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; for F in base_repo target_head_sha gp_anchor; do jq "del(.inputs.payload.$F)" "${FLEET_VALID_BUNDLE:?}" >"$D/$F.json"; if node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle "$D/$F.json" --workspace "${FLEET_TARGET_WORKTREE:?}" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/$F-out.json"; then exit 1; fi; jq -e --arg f "$F" '\''.failure_class=="payload_invalid" and .failed_field==$f'\'' "$D/$F-out.json"; done'

- [ ] [BEHAVIOR] [L2] B-03: GitHub 故障不得误报业务通过 [接缝×2]
  动作: 将 GitHub API 指向不可达地址并执行两次
  预期观察: 两次非零且 failed_dependency=github
  等待预算: 30s
  留证: 两份 environment_failure JSON
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; for N in 1 2; do if GITHUB_API_URL=http://127.0.0.1:1 node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/$N.json"; then exit 1; fi; jq -e '\''.failure_class=="environment_failure" and .failed_dependency=="github"'\'' "$D/$N.json"; done'

- [ ] [BEHAVIOR] [L2] B-04: Postgres 故障不得误报业务通过
  动作: 将 DB_URL 指向不可达端口后执行
  预期观察: CLI 非零且 failed_dependency=postgres
  等待预算: 30s
  留证: environment_failure JSON 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; if DB_URL=postgresql://127.0.0.1:1/unavailable node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/out.json"; then exit 1; fi; jq -e '\''.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="postgres"'\'' "$D/out.json"'

## Invariant 映射

- 共享 CI、生产代码、migration、调度默认禁改；task-plan 仅授权本 sprint 文件。
- ref 使用 `git rev-parse --verify '<ref>^{commit}'`；判变与终验同源。
- 临时路径为 `mktemp` 独享；secrets/PII 不写日志；当前 HEAD 不作目标真值。
- status/租户/API auth/cron/launchd/UI/真机/写库等其余铁律：N/A，本 sprint 不触及。
