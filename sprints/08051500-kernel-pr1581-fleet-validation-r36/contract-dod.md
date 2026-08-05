---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 只验本轮真实 Fleet payload 与既有结果证据是否绑定冻结目标，不新增生产 verifier 或结果 schema。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] Round 3 合同含 GP anchor、完整 E2E oracle 与四列 Test Contract。
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08051500-kernel-pr1581-fleet-validation-r36/contract-draft.md','utf8');for(const s of ['GP-Anchor: line02/keyword_acquisition#step7','## E2E 验收','## Test Contract'])if(!c.includes(s))process.exit(1)"
- [ ] [ARTIFACT] task-plan 只授权本 Sprint 合同与测试文件，不授权 PR #1581 业务实现、共享 CI 或 Harness 调度文件。
  Test: node -e "const p=require('./sprints/08051500-kernel-pr1581-fleet-validation-r36/task-plan.json');const f=p.tasks.flatMap(t=>t.files);if(f.some(x=>!x.startsWith('sprints/08051500-kernel-pr1581-fleet-validation-r36/')))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 原始 payload 三字段精确有效
  动作: 读取 Runner 提供的本轮真实 Fleet payload
  预期观察: 仓库、完整 target SHA 与 Step 7 anchor 逐字等于 PRD
  等待预算: 0s
  留证: jq 输出与 payload 摘要（不得含 secret）
  Test: manual:bash -c 'jq -e '"'"'.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and (.target_head_sha|test("^[0-9a-f]{40}$")) and .gp_anchor=="line02/keyword_acquisition#step7"'"'"' "$FLEET_PAYLOAD_PATH"'

- [ ] [BEHAVIOR] [L2] B-02: 冻结 base SHA 与 GP 唯一有效
  动作: 读取真实 payload 的 base_sha 并查询 product-map SSOT
  预期观察: base SHA 精确相等且 line02/keyword_acquisition#step7 匹配数恰为 1
  等待预算: 0s
  留证: 两条 jq exit code
  Test: manual:bash -c 'jq -e '"'"'.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"'"'"' "$FLEET_PAYLOAD_PATH" && jq -e '"'"'[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1'"'"' product-map/generated/product-map.json'

- [ ] [BEHAVIOR] [L2] B-03: PR head 与 evaluator checkout 同 SHA [接缝×2]
  动作: 真调 GitHub PR #1581 两次，并读取候选 checkout commit
  预期观察: 两次 PR head 与 checkout 都等于 payload target SHA
  等待预算: 30s
  留证: 两次 `.head.sha`、checkout SHA 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; T=$(jq -er '"'"'.target_head_sha'"'"' "$FLEET_PAYLOAD_PATH"); for N in 1 2; do curl -fsS https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581 > "$D/p-$N.json"; jq -er '"'"'.head.sha'"'"' "$D/p-$N.json" | grep -qx "$T"; done; C=$(git rev-parse --verify '"'"'HEAD^{commit}'"'"'); [ "$C" = "$T" ]'

- [ ] [BEHAVIOR] [L2] B-04: 既有结果证据绑定同一目标
  动作: 将本轮 Fleet 结果中的 target/evidence 与原始 payload 对账
  预期观察: 仓库、target SHA、GP anchor 与 candidate SHA 全部同值
  等待预算: 0s
  留证: jq exit code 与证据摘要
  Test: manual:bash -c 'jq -e --slurpfile p "$FLEET_PAYLOAD_PATH" '"'"'.target.base_repo==$p[0].base_repo and .target.target_head_sha==$p[0].target_head_sha and .target.gp_anchor==$p[0].gp_anchor and .evidence.candidate_sha==$p[0].target_head_sha'"'"' "$FLEET_RESULT_PATH"'

- [ ] [BEHAVIOR] [L2] B-05: 三字段任一篡改均被拒绝
  动作: 分别删除 base_repo、缩短 target SHA、漂移 GP anchor 后运行同一输入 oracle
  预期观察: 三个变体均非零退出且无成功输出
  等待预算: 5s
  留证: 三次 oracle exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for E in '"'"'del(.base_repo)'"'"' '"'"'.target_head_sha="short"'"'"' '"'"'.gp_anchor="line02/keyword_acquisition#step6"'"'"'; do jq "$E" "$FLEET_PAYLOAD_PATH" > "$D/p.json"; if jq -e '"'"'.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and (.target_head_sha|test("^[0-9a-f]{40}$")) and .gp_anchor=="line02/keyword_acquisition#step7"'"'"' "$D/p.json" >/dev/null; then exit 1; fi; done'

- [ ] [BEHAVIOR] [L2] B-06: GitHub 或 Postgres 不可用时不得通过 [接缝×2]
  动作: 分别请求拒绝连接的 HTTP 与 Postgres 端口两次
  预期观察: 每次连接均失败，脚本确认没有依赖故障被吞掉
  等待预算: 10s
  留证: 四次非零连接 exit code
  Test: manual:bash -c 'for N in 1 2; do if curl -fsS --connect-timeout 2 http://127.0.0.1:1 >/dev/null; then exit 1; fi; if psql '"'"'postgresql://127.0.0.1:1/unreachable?connect_timeout=2'"'"' -tAc '"'"'SELECT 1'"'"' >/dev/null 2>&1; then exit 1; fi; done'

- [ ] [BEHAVIOR] [L2] INV-1: 本 Sprint 不触碰共享基础设施或业务实现
  动作: 检查冻结 planner base 到候选提交的变更路径
  预期观察: 仅本 Sprint 目录内文件发生变化
  等待预算: 0s
  留证: git diff name-only
  Test: manual:bash -c 'BAD=$(git diff --name-only fd6bc889beaca3cd045080d408d37e3c5a2bcb48...HEAD | grep -v '"'"'^sprints/08051500-kernel-pr1581-fleet-validation-r36/'"'"' || :); [ -z "$BAD" ]'

## Invariant 映射

- 共享 CI 默认禁区、禁止修改 PR 业务实现/调度 → INV-1。
- ref 存在必须 `git rev-parse --verify '<ref>^{commit}'` → B-03。
- PR head SHA 与验收 SHA 一致、同一语义两端一致、接缝真验、manual oracle 真实 exit code → B-01 至 B-06。
- Test Contract 固定四列且 testFile 用 backtick → contract-draft 已遵守。
- evaluator 临时路径含 attempt/session → E2E 使用 `mktemp -d` 且前缀含 `HARNESS_ATTEMPT_ID`。
- validation identity late-bound、secret/PII 不进日志 → E2E 只读取 Runner 环境变量并输出非敏感 provenance。
- status/DB 表/job/cron/tenant/API auth/Android/UIA/launchd/部署等其余铁律 → N/A：本 Sprint 不触及对应模块。
