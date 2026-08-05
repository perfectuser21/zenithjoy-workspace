---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

## ARTIFACT 条目

- [ ] [ARTIFACT] `fleet-worker-receipt-check.mjs` 查询真实 Brain task receipt 并检查 attempt Postgres 可用性，输出确定性 JSON；`tests/run-negative-matrix.mjs` 参数化覆盖八个输入边界。
  Test: node -e "const fs=require('fs');for(const p of ['sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs','sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/run-negative-matrix.mjs'])fs.accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 真实 Fleet Worker receipt 输出绑定同一目标的完整结论 [接缝×2]
  动作: 以 Runner 注入的 task ID 调 Brain API receipt、attempt Postgres 和验收器
  预期观察: receipt 指向同一 task，输出 `ok:true` 及三字段、冻结 base
  等待预算: 30s
  留证: API/DB receipt 与 stdout JSON
  Test: manual:bash -c 'OUT=$(node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL"); echo "$OUT" | jq -e '"'"'.ok==true and .receipt.task_id==$ENV.HARNESS_TASK_ID and .receipt.source=="fleet-worker" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"'"'"''

- [ ] [BEHAVIOR] [L2] B-02: 成功结论 keys 完整且无漂移
  动作: 对真实 receipt 的验收 stdout 检查顶层 keys
  预期观察: keys 精确相等且 `failure_class=null`
  等待预算: 30s
  留证: jq 输出
  Test: manual:bash -c 'node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL" | jq -e '"'"'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","receipt","target_head_sha"] and .failure_class==null'"'"''

- [ ] [BEHAVIOR] [L2] B-03: base_repo 缺失与错值均拒绝
  动作: 参数化执行缺失、错仓库两个 case
  预期观察: 两 case 非零并分类 `payload_invalid`，无 `ok:true`
  等待预算: 5s
  留证: negative matrix 的 base_repo case 明细
  Test: manual:bash -c 'node sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/run-negative-matrix.mjs --only base_repo | jq -e '"'"'.cases==2 and .passed==2 and .unexpected_success==0'"'"''

- [ ] [BEHAVIOR] [L2] B-04: target_head_sha 缺失、非完整 SHA 与错 head 均拒绝
  动作: 参数化执行三种 target SHA 异常
  预期观察: 三 case 均 `payload_invalid`，不回退工作区 HEAD
  等待预算: 5s
  留证: negative matrix 的 target_head_sha 明细
  Test: manual:bash -c 'node sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/run-negative-matrix.mjs --only target_head_sha | jq -e '"'"'.cases==3 and .passed==3 and .unexpected_success==0'"'"''

- [ ] [BEHAVIOR] [L2] B-05: gp_anchor 缺失、错值与非唯一解析均拒绝
  动作: 参数化执行三种锚点异常
  预期观察: 三 case 均 `payload_invalid`，不猜测其他 Step
  等待预算: 5s
  留证: negative matrix 的 gp_anchor case 明细
  Test: manual:bash -c 'node sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/run-negative-matrix.mjs --only gp_anchor | jq -e '"'"'.cases==3 and .passed==3 and .unexpected_success==0'"'"''

- [ ] [BEHAVIOR] [L2] B-06: Brain、Postgres、GitHub 不可用均为环境失败 [接缝×2]
  动作: 逐个连接真实不可达端口/host 并执行验收入口
  预期观察: 每次非零，JSON 为 `ok:false,failure_class:environment_failure` 且绝无 `ok:true`
  等待预算: 10s
  留证: 三个依赖的失败 JSON 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-env-${HARNESS_ATTEMPT_ID}.XXXXXX"); trap "rm -rf $D" EXIT; if node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url http://127.0.0.1:1 --db-url "$DB_URL" > "$D/brain.json" 2>&1; then exit 1; fi; if node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "postgresql://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1" > "$D/postgres.json" 2>&1; then exit 1; fi; if GH_HOST=127.0.0.1 node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL" > "$D/github.json" 2>&1; then exit 1; fi; for DEP in brain postgres github; do jq -e '"'"'.ok==false and .failure_class=="environment_failure" and .ok!=true'"'"' "$D/$DEP.json" || exit 1; done'

## Invariant 覆盖

- INV-01 常驻服务/launchd/双信号：N/A，不安装服务。
- INV-02 status 枚举：N/A，不新增状态；全仓 status 检查无需变更。
- INV-03 共享 CI 禁区：合同明确不修改 workflow 与 smoke allowlist。
- INV-04 同义 SHA：payload、receipt、GitHub、结论使用同一精确 SHA；冻结 base 单独验证祖先关系。
- INV-05 Test Contract：固定四列且 testFile 反引号包裹。
- INV-06 表/job/cron/租户：N/A，不建表/job，不碰租户业务数据。
- INV-07 提前 merge：receipt target SHA 与 PR head 精确对账。
- INV-08 git ref：只用 `rev-parse --verify "<ref>^{commit}"`。
- INV-09 headed/target environment：真实 task payload 含 base_repo/gp_anchor/target_environment；不以分支或文件代替。
- INV-10 evaluator 临时文件：路径含当前 attempt ID 并由 trap 清理。
- INV-11 真实接缝：Brain、Postgres、GitHub 真验；未通过不得 done。
- INV-12 失败/告警：依赖失败非零且明确 `environment_failure`，不 warning 降级。
- INV-13 secrets/PII：凭据仅由 Runner 注入且不打印。
- INV-14 auth/双租户：N/A，不新增 API 或租户数据路径。
- INV-15 判变生产实体：使用 GitHub `headRefOid`，不用工作区 diff/HEAD。
- INV-16 Red commit/单 slot：只登记本 sprint 测试；task-plan 仅 ws1。
- INV-17 manual oracle：记录真实 exit code并由 Node 执行验收器。
- INV-18 DB 连接一致：Postgres 检查只使用 Runner 注入的 attempt `DB_URL`，不假设空库含 Brain 业务表且无第二默认值。
- INV-19 validation identity：全部 late-bound，无角色 UUID 字面量。
- INV-20 其余铁律：RPA/UI、多端、付费 API、调度、watchdog、表字段、部署、退役、merge/report 权限均不在本 sprint 范围，N/A。
