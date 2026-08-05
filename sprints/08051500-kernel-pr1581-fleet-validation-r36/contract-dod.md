---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 从 attempt 空库 bootstrap 后直接执行生产 Fleet Worker；禁止预制成功 receipt 或 sprint 内旁路 validator。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 生产 Worker 与真实 migration 存在
  Test: bash -c 'grep -q "validate" packages/brain/src/harness/fleet-worker.js && grep -q "harness_validation_receipts" packages/brain/migrations/20260804_create_harness_validation_receipts.sql'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 经生产 Fleet Worker 对账后通过 [接缝×2]
  动作: 将同一 bundle 交给生产 Worker 两次
  预期观察: 两份 receipt 均 passed，repo/base/head/anchor 一致且无 skipped check
  等待预算: 120s
  留证: 两次 CLI exit code 与 receipt SHA-256
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/r$N.json"; jq -e '"'"'.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and (all(.checks[];.status=="passed" and .skipped!=true))'"'"' "$D/r$N.json"; done'

- [ ] [BEHAVIOR] [L2] B-02: 三个权威字段的缺失或不一致均被生产 Worker 拒绝
  动作: 分别删除 repo、缩短 SHA、漂移 anchor 后调用生产 Worker
  预期观察: 每次 CLI 非零且 receipt failed，并点名对应 failed_field
  等待预算: 120s
  留证: 三条失败 receipt 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for S in repo head gp; do case "$S" in repo) J='"'"'del(.inputs.payload.base_repo)'"'"'; F=base_repo;; head) J='"'"'.inputs.payload.target_head_sha="HEAD"'"'"'; F=target_head_sha;; gp) J='"'"'.inputs.payload.gp_anchor="line02/keyword_acquisition#step999"'"'"'; F=gp_anchor;; esac; jq "$J" "${FLEET_VALID_BUNDLE:?}" >"$D/$S.json"; if node packages/brain/src/harness/fleet-worker.js validate --bundle "$D/$S.json" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/$S-r.json"; then exit 1; fi; jq -e --arg f "$F" '"'"'.status=="failed" and .failure_class!="none" and .failed_field==$f'"'"' "$D/$S-r.json"; done'

- [ ] [BEHAVIOR] [L2] B-03: GitHub 与 Postgres 故障绑定环境失败分类 [接缝×2]
  动作: 通过生产 Worker 支持的依赖 URL 注入分别阻断 GitHub 与 Postgres，各两次
  预期观察: 四次均非零，failure_class=environment_failure 且 failed_dependency 精确
  等待预算: 120s
  留证: 四条 failure receipt 与真实 CLI exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do if GITHUB_API_URL=http://127.0.0.1:1 node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/g$N.json"; then exit 1; fi; jq -e '"'"'.failure_class=="environment_failure" and .failed_dependency=="github"'"'"' "$D/g$N.json"; if DB_URL=postgresql://127.0.0.1:1/unavailable node packages/brain/src/harness/fleet-worker.js validate --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --receipt "$D/p$N.json"; then exit 1; fi; jq -e '"'"'.failure_class=="environment_failure" and .failed_dependency=="postgres"'"'"' "$D/p$N.json"; done'

- [ ] [BEHAVIOR] [L2] B-04: 当前 Runner 身份与五分钟内 receipt 账本一致
  动作: 生产 Worker 生成 receipt 后核对 late-bound provenance 与 attempt-scoped DB
  预期观察: identity 全字段来自当前 Runner，且 DB 新增当前 attempt/target 行
  等待预算: 30s
  留证: jq 与带时间窗 psql 输出
  Test: manual:bash -c 'R=$(mktemp); trap '"'"'rm -f "$R"'"'"' EXIT; node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$R"; jq -e '"'"'.runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.provider==env.HARNESS_PROVIDER and .runner_provenance.account==env.HARNESS_ACCOUNT and .runner_provenance.machine==env.HARNESS_MACHINE and .runner_provenance.model==env.HARNESS_MODEL and .runner_provenance.runner_digest==env.HARNESS_RUNNER_DIGEST and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID'"'"' "$R"; psql "${DB_URL:?}" -tAc "SELECT count(*) FROM harness_validation_receipts WHERE attempt_id='"'"'${HARNESS_ATTEMPT_ID}'"'"' AND target_head_sha='"'"'c305f6217da65bb69413c39e621b7e797e0fb189'"'"' AND created_at>NOW()-interval '"'"'5 minutes'"'"'" | grep -Eq '"'"'^[1-9][0-9]*$'"'"''

## Invariant 映射

- 共享 CI、业务实现、调度文件默认禁改；task-plan 仅含本 sprint 文件。
- ref 仅用 `git rev-parse --verify '<ref>^{commit}'`；判变与终验同源。
- evaluator 临时路径含当前 attempt；secrets/PII 不写日志。
- validation identity 全部 late-bound；真接缝未执行只能标 logic-done-pending。
- status/租户/API auth/cron/launchd/UI/真机等其余铁律：N/A，本 sprint 不触及。
