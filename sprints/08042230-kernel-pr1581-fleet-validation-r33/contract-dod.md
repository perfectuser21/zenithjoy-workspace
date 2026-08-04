---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 仅验生产 Fleet Worker CLI 对 payload 的消费与 receipt 绑定；从空库 migration bootstrap 后真派发，禁止预制 receipt 或 sprint 内旁路校验器。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 本 sprint 不得新增 `validate-fleet-payload.*` 旁路
  Test: bash -c '! find sprints/08042230-kernel-pr1581-fleet-validation-r33 -maxdepth 1 -name "validate-fleet-payload.*" | grep -q .'

- [ ] [ARTIFACT] Fleet Worker 生产执行体与 receipt migration 存在
  Test: bash -c 'grep -q "validate" packages/brain/src/harness/fleet-worker.js && grep -q "CREATE TABLE.*harness_validation_receipts" packages/brain/migrations/20260804_create_harness_validation_receipts.sql'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 仅在真实 Fleet 权威对账后通过 [接缝×2]
  动作: 用 `node packages/brain/src/harness/fleet-worker.js validate` 将同一真实 bundle 派发到冻结 checkout 两次。
  预期观察: receipt passed，repo/base/head/anchor 精确一致，所有 checks 真执行且无 skipped。
  等待预算: 120s
  留证: 两次 CLI exit code、receipt SHA-256 与字段对比
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/r$N.json"; jq -e '"'"'.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and (all(.checks[];.status=="passed" and .skipped!=true))'"'"' "$D/r$N.json"; done; jq -s -e '"'"'.[0].target_head_sha==.[1].target_head_sha and .[0].gp_anchor==.[1].gp_anchor'"'"' "$D/r1.json" "$D/r2.json"'

- [ ] [BEHAVIOR] [L2] B-02: base_repo 缺失或错误必须拒绝
  动作: 经 Harness 变异派发删除 repo，再替换成其他仓库。
  预期观察: 两例均 failed，`failed_field=base_repo` 且 error 点名该字段；缺失为 payload_invalid，错仓库为 target_mismatch。
  等待预算: 60s
  留证: 两条 mutation receipt
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; jq '"'"'del(.inputs.payload.base_repo)'"'"' "${FLEET_VALID_BUNDLE:?}" >"$D/a.json"; jq '"'"'.inputs.payload.base_repo="wrong/repo"'"'"' "$FLEET_VALID_BUNDLE" >"$D/b.json"; if node packages/brain/src/harness/fleet-worker.js validate --bundle "$D/a.json" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/a-r.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="payload_invalid" and .failed_field=="base_repo" and (.error|test("base_repo"))'"'"' "$D/a-r.json"; if node packages/brain/src/harness/fleet-worker.js validate --bundle "$D/b.json" --workspace "$FLEET_TARGET_WORKTREE" --receipt "$D/b-r.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="target_mismatch" and .failed_field=="base_repo" and (.error|test("base_repo"))'"'"' "$D/b-r.json"'

- [ ] [BEHAVIOR] [L2] B-03: target_head_sha 全边界必须拒绝
  动作: 经 Harness 分别派发缺失 SHA、`HEAD` 和错误完整 SHA。
  预期观察: 三例 failed 且 `failed_field=target_head_sha`、error 点名该字段；缺失/短 SHA 为 payload_invalid，完整错误 SHA 为 target_mismatch，不回退当前 HEAD。
  等待预算: 60s
  留证: 三条 mutation receipt
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; jq '"'"'del(.inputs.payload.target_head_sha)'"'"' "${FLEET_VALID_BUNDLE:?}" >"$D/a.json"; jq '"'"'.inputs.payload.target_head_sha="HEAD"'"'"' "$FLEET_VALID_BUNDLE" >"$D/b.json"; jq '"'"'.inputs.payload.target_head_sha="0000000000000000000000000000000000000000"'"'"' "$FLEET_VALID_BUNDLE" >"$D/c.json"; for C in a b; do if node packages/brain/src/harness/fleet-worker.js validate --bundle "$D/$C.json" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/$C-r.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="payload_invalid" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))'"'"' "$D/$C-r.json"; done; if node packages/brain/src/harness/fleet-worker.js validate --bundle "$D/c.json" --workspace "$FLEET_TARGET_WORKTREE" --receipt "$D/c-r.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="target_mismatch" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))'"'"' "$D/c-r.json"'

- [ ] [BEHAVIOR] [L2] B-04: gp_anchor 缺失或不唯一必须拒绝
  动作: 经 Harness 删除 anchor，再传不能唯一解析到 Step 7 的 anchor。
  预期观察: 两例 failed/payload_invalid，`failed_field=gp_anchor` 且 error 点名该字段，Fleet 不猜测其他 Step。
  等待预算: 60s
  留证: 两条 mutation receipt
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; jq '"'"'del(.inputs.payload.gp_anchor)'"'"' "${FLEET_VALID_BUNDLE:?}" >"$D/a.json"; jq '"'"'.inputs.payload.gp_anchor="line02/keyword_acquisition"'"'"' "$FLEET_VALID_BUNDLE" >"$D/b.json"; for C in a b; do if node packages/brain/src/harness/fleet-worker.js validate --bundle "$D/$C.json" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/$C-r.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="payload_invalid" and .failed_field=="gp_anchor" and (.error|test("gp_anchor"))'"'"' "$D/$C-r.json"; done'

- [ ] [BEHAVIOR] [L2] B-05: GitHub 或 Postgres 不可用不得成功 [接缝×2]
  动作: 由 Fleet 故障注入通道分别阻断 GitHub 与 attempt-scoped Postgres，各执行两次。
  预期观察: 四次均 failed 且 failure_class=environment_failure。
  等待预算: 120s
  留证: 四条依赖故障 receipt 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for N in 1 2; do if GITHUB_API_URL=http://127.0.0.1:1 node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$D/g$N.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="github"'"'"' "$D/g$N.json"; if DB_URL=postgresql://127.0.0.1:1/unavailable node packages/brain/src/harness/fleet-worker.js validate --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --receipt "$D/p$N.json"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="postgres"'"'"' "$D/p$N.json"; done'

- [ ] [BEHAVIOR] [L2] B-06: 当前 Runner 身份和新鲜账本记录一致
  动作: 真实调用生产 CLI 生成 receipt，用 Runner 注入身份核对并查 attempt-scoped Postgres。
  预期观察: attempt/capability 相等，五分钟内恰有一条目标 SHA 记录。
  等待预算: 5s
  留证: jq 结果和 DB count
  Test: manual:bash -c 'R=$(mktemp); trap '"'"'rm -f "$R"'"'"' EXIT; node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$R"; jq -e '"'"'.runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID'"'"' "$R" >/dev/null; psql "${DB_URL:?}" -v ON_ERROR_STOP=1 -tAc "SELECT count(*)>0 FROM harness_validation_receipts WHERE attempt_id='"'"'${HARNESS_ATTEMPT_ID:?}'"'"' AND target_head_sha='"'"'c305f6217da65bb69413c39e621b7e797e0fb189'"'"' AND created_at>NOW()-interval '"'"'5 minutes'"'"'" | grep -qx t'

- [ ] [BEHAVIOR] [L2] B-07: attempt 空库先经真实 migration bootstrap
  动作: 对 Fleet 注入的全新 `DB_URL` 运行仓库 receipt migration，再启动 Worker。
  预期观察: migration exit 0，目标表可解析；未 bootstrap 时 Worker 必须 environment_failure，不能伪造成功。
  等待预算: 30s
  留证: migration exit code、`to_regclass` 输出与失败 receipt
  Test: manual:bash -c 'psql "${DB_URL:?}" -v ON_ERROR_STOP=1 -f packages/brain/migrations/20260804_create_harness_validation_receipts.sql >/dev/null; psql "$DB_URL" -tAc "SELECT to_regclass('"'"'harness_validation_receipts'"'"') IS NOT NULL" | grep -qx t'

- [ ] [BEHAVIOR] [L2] B-08: product-map 依赖缺失必须真失败
  动作: 在隔离的目标 checkout 中删除生成的 product-map JSON，再调用同一生产 Fleet Worker CLI。
  预期观察: CLI exit 非零，receipt 为 failed/environment_failure 且 failed_dependency=product_map，不产生 passed 账本。
  等待预算: 30s
  留证: CLI exit code、失败 receipt 与五分钟 DB 查询
  Test: manual:bash -c 'W=$(mktemp -d); R=$(mktemp); trap '"'"'rm -rf "$W" "$R"'"'"' EXIT; cp -R "${FLEET_TARGET_WORKTREE:?}/." "$W/"; rm -f "$W/product-map/generated/product-map.json"; if node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "$W" --receipt "$R"; then exit 1; fi; jq -e '"'"'.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="product_map"'"'"' "$R"'

## Invariant 映射

- INV-01 常驻服务/LaunchAgent/UI/真机/cron/租户/API auth：N/A，本 sprint 不触及。
- INV-02 status 同类断言：修改 receipt status 前必须全仓 grep，避免语义分叉。
- INV-03 共享 CI 禁区：不得修改 `.github/workflows/**` 或 smoke allowlist。
- INV-04 判变与终验同源：都使用 payload、GitHub PR、冻结 checkout 与 product-map。
- INV-05 Test Contract：固定四列且 testFile 用 backtick。
- INV-06 PR 提前合并：receipt target SHA 仍须与 PR head 对账。
- INV-07 ref 只用 `git rev-parse --verify '<sha>^{commit}'`。
- INV-08 evaluator 临时目录含当前 attempt；禁止共享固定 `/tmp` 文件。
- INV-09 接缝只有真实 Fleet 重复派发、GitHub/Postgres 故障验证后才 done。
- INV-10 secrets/PII 不进入 receipt 或日志。
- INV-11 生产实体 GitHub PR head 为权威，不使用工作区 diff。
- INV-12 payload 的 base_repo/target_head_sha/gp_anchor 缺失即拒绝。
- INV-13 manual oracle 记录真实 exit code并确认解释器启动。
- INV-14 validation identity 从当前 Runner late-bound，不固化作者 UUID。
- INV-15 其余铁律与本 sprint 无交集，显式 N/A；`npm run product-map:check` 必须通过。
