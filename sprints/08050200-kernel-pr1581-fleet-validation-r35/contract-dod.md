---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 真实 task bundle 三字段消费、冻结事实校验和回执绑定；不修改业务实现、调度或共享 CI。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 独立负例 oracle 可执行且不含虚构 Fleet 环境变量
  Test: bash -n sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-oracle.sh

- [ ] [ARTIFACT] Generator 只改本 sprint 目录
  Test: bash -c 'test -z "$(git diff --name-only 49fa4ebddde73b8f3d2d800793f2a13c79434b06...HEAD | grep -v "^sprints/08050200-kernel-pr1581-fleet-validation-r35/" || true)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Step 1 从真实 Runner bundle 读取三个权威字段
  动作: 读取 Runner 注入的 `HARNESS_TASK_BUNDLE_FILE` 中 `.inputs` 三字段
  预期观察: repo、target SHA、GP anchor 与冻结 PRD 逐字相等
  等待预算: 0s
  留证: jq 输出和 exit code
  Test: manual:bash -c 'jq -e '\''.inputs|type=="object" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'\'' "$HARNESS_TASK_BUNDLE_FILE"'

- [ ] [BEHAVIOR] [L2] B-02: Step 2 两个冻结 commit 均可严格解析
  动作: 用 `git rev-parse --verify <sha>^{commit}` 校验 base 与 target
  预期观察: 两个输出分别精确等于冻结 SHA，不回退 HEAD
  等待预算: 0s
  留证: 两行 git object SHA
  Test: manual:bash -c 'B=676fed7de12023d355deac7849af8a525ae53f8d; T=$(jq -er .inputs.target_head_sha "$HARNESS_TASK_BUNDLE_FILE"); git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"'

- [ ] [BEHAVIOR] [L2] B-03: Step 2 PR head 真值与 payload 一致 [接缝×2]
  动作: 连续两次真调 GitHub PR #1581 API
  预期观察: 两次 `.head.sha` 都精确等于 payload target SHA
  等待预算: 30s
  留证: 两次 GitHub SHA 输出
  Test: manual:bash -c 'T=$(jq -er .inputs.target_head_sha "$HARNESS_TASK_BUNDLE_FILE"); for n in 1 2; do H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha); echo "$H"; [ "$H" = "$T" ] || exit 1; done'

- [ ] [BEHAVIOR] [L2] B-04: Step 2 锚点唯一解析到 Step 7
  动作: 用 product-map SSOT 查询 line、GP 与 step
  预期观察: 精确匹配数为 1
  等待预算: 0s
  留证: jq true 与 exit code
  Test: manual:bash -c 'jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json'

- [ ] [BEHAVIOR] [L2] B-05: Step 2 Fleet attempt Postgres 资源可用 [接缝×2]
  动作: 对 Runner 注入的同一 `DB_URL` 连续执行两次只读查询
  预期观察: 两次均返回整数 1
  等待预算: 10s
  留证: psql 两次输出与 exit code
  Test: manual:bash -c 'for n in 1 2; do psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc "SELECT 1" | grep -qx 1; done'

- [ ] [BEHAVIOR] [L2] B-06: Step 3 回执 schema 与当前 validation identity 完整
  动作: 读取 E2E 本轮真实结果构建的 `RECEIPT_FILE`
  预期观察: 顶层 keys 精确，status=passed，目标字段与 identity 7/7 相等
  等待预算: 0s
  留证: receipt jq 输出与 SHA-256
  Test: manual:bash -c 'jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg c "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg d "$HARNESS_RUNNER_DIGEST" --arg s "$CAPABILITY_SNAPSHOT_ID" '\''keys==["base_repo","base_sha","failure_class","gp_anchor","status","target_head_sha","validation_identity"] and .status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class==null and .validation_identity=={attempt_id:$a,provider:$p,account:$c,machine:$m,model:$model,runner_digest:$d,capability_snapshot_id:$s}'\'' "$RECEIPT_FILE" && sha256sum "$RECEIPT_FILE"'

- [ ] [BEHAVIOR] [L2] B-07: Step 3 禁用同义字段不进入回执
  动作: 检查 E2E receipt 的 schema 完整性
  预期观察: `repo/head_sha/anchor/ok` 全部不存在
  等待预算: 0s
  留证: jq true 与 exit code
  Test: manual:bash -c 'jq -e '\''has("repo")|not'\'' "$RECEIPT_FILE" && jq -e '\''has("head_sha")|not'\'' "$RECEIPT_FILE" && jq -e '\''has("anchor")|not'\'' "$RECEIPT_FILE" && jq -e '\''has("ok")|not'\'' "$RECEIPT_FILE"'

- [ ] [BEHAVIOR] [L2] B-08: Step 4 输入篡改与依赖失败全部 fail-closed
  动作: 运行缺 repo、短 SHA、错 anchor、GitHub 不可用、Postgres 不可用五组负例
  预期观察: 每组内部校验非零且无 passed；汇总脚本 exit 0
  等待预算: 30s
  留证: 五组 `REJECTED` 输出与最终 exit code
  Test: manual:bash -c 'bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-oracle.sh --negative-matrix "$HARNESS_TASK_BUNDLE_FILE"'

## Invariant 映射

- INV-01（目标真值/strict ref/同一语义/依赖失败/DB 同源/真实 exit code）由 B-01、B-02、B-03、B-05、B-08 覆盖。
- INV-02（GP anchor、Test Contract 四列、secret/PII 不落回执、共享 CI 禁区）由 B-04、B-06、ARTIFACT-02 与 contract-draft Test Contract 覆盖。
- N/A：本 sprint 不新增服务、状态值、表、job、API、租户数据、通知、RPA、UI、cron、部署、relay session、watchdog、付费 API 或生产日志，thin PRD 中对应铁律均不触及。
- N/A：generator merge、controller report、PR 冲突/提前合并、毕业测试入册、smoke allowlist 属后续流程权限，不是本合同实现范围。
