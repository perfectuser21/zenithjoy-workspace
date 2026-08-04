---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 仅验真实 Fleet Worker payload 消费与 receipt 绑定；禁止 sprint 内旁路校验器。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 本 sprint 不得新增 `validate-fleet-payload.*` 旁路
  Test: bash -c '! find sprints/08042230-kernel-pr1581-fleet-validation-r33 -maxdepth 1 -name "validate-fleet-payload.*" | grep -q .'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 仅在真实 Fleet 权威对账后通过 [接缝×2]
  动作: 读取 Runner 暴露的原始 task bundle 与真实 Fleet receipt，并重复派发两次。
  预期观察: receipt passed，repo/base/head/anchor 精确一致，所有 checks 真执行且无 skipped。
  等待预算: 120s
  留证: `${HARNESS_FLEET_RECEIPT_PATH}` SHA-256 与 repeat_runs
  Test: manual:bash -c 'jq -e '"'"'.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and (all(.checks[];.status=="passed" and .skipped!=true)) and (.repeat_runs|length==2)'"'"' "${HARNESS_FLEET_RECEIPT_PATH:?}"'

- [ ] [BEHAVIOR] [L2] B-02: base_repo 缺失或错误必须拒绝
  动作: 经 Harness 变异派发删除 repo，再替换成其他仓库。
  预期观察: repo_missing 与 repo_wrong 均 failed，failure_class 非 none。
  等待预算: 60s
  留证: 两条 mutation receipt
  Test: manual:bash -c 'jq -e '"'"'[.mutation_receipts[]|select((.case=="repo_missing" or .case=="repo_wrong") and .status=="failed" and .failure_class!="none")]|length==2'"'"' "${HARNESS_FLEET_RECEIPT_PATH:?}"'

- [ ] [BEHAVIOR] [L2] B-03: target_head_sha 全边界必须拒绝
  动作: 经 Harness 分别派发缺失 SHA、`HEAD` 和错误完整 SHA。
  预期观察: 三例 failed，不回退当前工作区 HEAD。
  等待预算: 60s
  留证: 三条 mutation receipt
  Test: manual:bash -c 'jq -e '"'"'[.mutation_receipts[]|select((.case=="target_head_missing" or .case=="target_head_short" or .case=="target_head_mismatch") and .status=="failed" and .failure_class!="none")]|length==3'"'"' "${HARNESS_FLEET_RECEIPT_PATH:?}"'

- [ ] [BEHAVIOR] [L2] B-04: gp_anchor 缺失或不唯一必须拒绝
  动作: 经 Harness 删除 anchor，再传不能唯一解析到 Step 7 的 anchor。
  预期观察: 两例 failed，Fleet 不猜测其他 Step。
  等待预算: 60s
  留证: 两条 mutation receipt
  Test: manual:bash -c 'jq -e '"'"'[.mutation_receipts[]|select((.case=="gp_anchor_missing" or .case=="gp_anchor_ambiguous") and .status=="failed" and .failure_class!="none")]|length==2'"'"' "${HARNESS_FLEET_RECEIPT_PATH:?}"'

- [ ] [BEHAVIOR] [L2] B-05: GitHub 或 Postgres 不可用不得成功 [接缝×2]
  动作: 由 Fleet 故障注入通道分别阻断 GitHub 与 attempt-scoped Postgres，各执行两次。
  预期观察: 四次均 failed 且 failure_class=environment_failure。
  等待预算: 120s
  留证: 四条依赖故障 receipt 与 exit code
  Test: manual:bash -c 'jq -e '"'"'[.mutation_receipts[]|select((.case=="github_unavailable" or .case=="postgres_unavailable") and .status=="failed" and .failure_class=="environment_failure")]|group_by(.case)|map(select(length==2))|length==2'"'"' "${HARNESS_FLEET_RECEIPT_PATH:?}"'

- [ ] [BEHAVIOR] [L2] B-06: 当前 Runner 身份和新鲜账本记录一致
  动作: 用 Runner 注入身份核对 receipt，并查 attempt-scoped Postgres。
  预期观察: attempt/capability 相等，五分钟内恰有一条目标 SHA 记录。
  等待预算: 5s
  留证: jq 结果和 DB count
  Test: manual:bash -c 'jq -e '"'"'.runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID'"'"' "${HARNESS_FLEET_RECEIPT_PATH:?}" >/dev/null; psql "${DB_URL:?}" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM harness_validation_receipts WHERE attempt_id='"'"'${HARNESS_ATTEMPT_ID:?}'"'"' AND target_head_sha='"'"'c305f6217da65bb69413c39e621b7e797e0fb189'"'"' AND created_at>NOW()-interval '"'"'5 minutes'"'"'" | grep -qx 1'

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
