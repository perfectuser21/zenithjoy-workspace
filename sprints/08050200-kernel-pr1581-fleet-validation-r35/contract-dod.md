---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 只验证 Fleet Worker 三字段消费及回执目标绑定，不修改 PR #1581 或 Harness 调度。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 本轮 Fleet 验收回执满足 contract-draft.md 的 Response Schema
  Test: node -e "const fs=require('fs');const p=process.env.FLEET_VALIDATION_RECEIPT;if(!p)process.exit(1);const x=JSON.parse(fs.readFileSync(p,'utf8'));for(const k of ['status','base_repo','base_sha','target_head_sha','gp_anchor','failure_class','validation_identity'])if(!(k in x))process.exit(1)"

- [ ] [ARTIFACT] Generator 不修改共享 CI 基础设施或 PR #1581 业务实现
  Test: bash -c 'test -z "$(git diff --name-only 49fa4ebddde73b8f3d2d800793f2a13c79434b06...HEAD | grep -E "^(\.github/workflows/|packages/quality/smoke-allowlist\.txt|apps/|packages/|services/)" || true)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Step 1 实际 payload 三个权威字段逐字保留
  动作: 读取 Runner 注入的实际 Fleet task payload
  预期观察: base_repo、target_head_sha、gp_anchor 与冻结 PRD 精确相等
  等待预算: 0s
  留证: jq 输出与退出码
  Test: manual:bash -c 'jq -e '\''type=="object" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'\'' <<<"$HARNESS_TASK_PAYLOAD_JSON"'

- [ ] [BEHAVIOR] [L2] B-02: Step 2 PR head 与 payload SHA 精确一致 [接缝×2]
  动作: 连续两次真调 GitHub PR API，并用 git commit 解析核对目标 SHA
  预期观察: 两次 PR head 都等于 payload target_head_sha，且 commit 可解析
  等待预算: 30s
  留证: GitHub API 返回 SHA 与 git rev-parse 输出
  Test: manual:bash -c 'T=$(jq -er .target_head_sha <<<"$HARNESS_TASK_PAYLOAD_JSON"); git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; for n in 1 2; do H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha); [ "$H" = "$T" ] || exit 1; done'

- [ ] [BEHAVIOR] [L2] B-03: Step 2 GP 锚点唯一解析到 Step 7
  动作: 用 product-map SSOT 精确查询 line、GP 与 step
  预期观察: line02/keyword_acquisition#step7 匹配数恰为 1
  等待预算: 0s
  留证: jq 布尔输出与退出码
  Test: manual:bash -c 'jq -e '\''[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[]; .id=="step7"))] | length==1'\'' product-map/generated/product-map.json'

- [ ] [BEHAVIOR] [L2] B-04: Step 3 审计回执绑定冻结目标与当前 validation identity
  动作: 读取 Fleet Worker 本轮真实回执并与冻结目标、Runner 当前身份逐字段比较
  预期观察: status=passed、failure_class=null、目标字段精确一致且 identity 7/7 匹配
  等待预算: 10s
  留证: receipt jq 输出、exit code 与回执 SHA-256
  Test: manual:bash -c 'jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg c "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg d "$HARNESS_RUNNER_DIGEST" --arg s "$CAPABILITY_SNAPSHOT_ID" '\''.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class==null and .validation_identity=={attempt_id:$a,provider:$p,account:$c,machine:$m,model:$model,runner_digest:$d,capability_snapshot_id:$s}'\'' "$FLEET_VALIDATION_RECEIPT" && sha256sum "$FLEET_VALIDATION_RECEIPT"'

- [ ] [BEHAVIOR] [L2] B-05: Step 4 三字段篡改与依赖失败全部 fail-closed
  动作: 依次注入 base_repo 错值、短 SHA、错误 anchor 和依赖不可用场景
  预期观察: 四组负例均非零失败，且没有 status=passed 结论
  等待预算: 30s
  留证: 校验器四组负例汇总输出与退出码
  Test: manual:bash -c '"$FLEET_VALIDATOR" --self-test-negative "$HARNESS_TASK_PAYLOAD_JSON" "$FLEET_VALIDATION_RECEIPT"'

## Invariant 映射

PRD 铁律逐条处理规则：与本验证直接相关者由下列 INV 条目执行；其余均为 N/A，因为本 sprint 不新增服务、API、DB schema/job、租户查询、RPA、UI、部署、cron、日志或共享 CI 修改。

- [ ] [BEHAVIOR] [L2] INV-01: 不从工作区 HEAD 回退目标 SHA，ref 校验使用 `--verify <ref>^{commit}`
  动作: 对 payload 目标 SHA 执行严格 commit 验证并核对 GitHub PR head
  预期观察: 目标 SHA 可解析且等于 PR head
  等待预算: 30s
  留证: git 与 gh 输出
  Test: manual:bash -c 'T=$(jq -er .target_head_sha <<<"$HARNESS_TASK_PAYLOAD_JSON"); test "$T" != "$(git rev-parse HEAD)" || true; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; test "$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)" = "$T"'

- [ ] [BEHAVIOR] [L2] INV-02: 同一 payload 语义在判变端与终验端一致
  动作: 同时将 payload 与 receipt 三字段规范化为一行并比较
  预期观察: 三字段逐字相同
  等待预算: 0s
  留证: 两侧规范化 JSON
  Test: manual:bash -c 'P=$(jq -c '\''[.base_repo,.target_head_sha,.gp_anchor]'\'' <<<"$HARNESS_TASK_PAYLOAD_JSON"); R=$(jq -c '\''[.base_repo,.target_head_sha,.gp_anchor]'\'' "$FLEET_VALIDATION_RECEIPT"); [ "$P" = "$R" ]'

- [ ] [BEHAVIOR] [L2] INV-03: 依赖失败不得 warning 降级或冒充 passed
  动作: 运行校验器 dependency_unavailable 负例
  预期观察: 非零退出且生成/保留的负例回执 status 不为 passed
  等待预算: 10s
  留证: 校验器负例输出
  Test: manual:bash -c '"$FLEET_VALIDATOR" --self-test-negative-case dependency_unavailable "$HARNESS_TASK_PAYLOAD_JSON" "$FLEET_VALIDATION_RECEIPT"'

- [ ] [BEHAVIOR] [L2] INV-04: Test Contract 固定四列且路径位于第三列解析约定不漂移
  动作: 运行合同结构检查器解析 Test Contract
  预期观察: 表头四列且 Test File 位于第二列、BEHAVIOR 覆盖位于第三列
  等待预算: 0s
  留证: node 检查器退出码
  Test: manual:bash -c 'node -e "const fs=require('\''fs'\'');const s=fs.readFileSync('\''sprints/08050200-kernel-pr1581-fleet-validation-r35/contract-draft.md'\'', '\''utf8'\'');const h=s.match(/\| 功能 \| Test File \| BEHAVIOR 覆盖 \| 预期红证据 \|/);if(!h)process.exit(1);Promise.resolve().then(()=>console.log('\''OK'\''))"'

- [ ] [BEHAVIOR] [L2] INV-05: 验收结论携带 Judge 消费所需语义且不泄露 secret
  动作: 检查回执只有合同允许字段且包含 status/failure_class/validation_identity
  预期观察: 无 token、cookie、secret、authorization 字段
  等待预算: 0s
  留证: jq 输出
  Test: manual:bash -c 'jq -e '\''has("status") and has("failure_class") and has("validation_identity") and ([paths(scalars)|map(tostring)|join(".")|ascii_downcase|test("token|cookie|secret|authorization")] | any | not)'\'' "$FLEET_VALIDATION_RECEIPT"'

- N/A-01: LaunchAgent/LaunchDaemon、launchd patrol、服务双信号、headed relay/tmux/心跳/session、watchdog/reaper——本 sprint 不创建或管理宿主服务与 relay session。
- N/A-02: status 枚举全仓复查、scheduler/cron、后台 job 消费方与失败指标、跨扫描周期/时间常数/探针窗口——本 sprint 不改状态机、调度或后台 job。
- N/A-03: DB 表认领、列长、agents 列名、租户隔离、两租户测试、DB_NAME、写库时间窗、journey_features——本 sprint 不建表、不写业务 DB、不改租户数据。
- N/A-04: API auth、通知 sent/accepted、null/false 契约、Brain judge API 格式——本 sprint 不新增 API/通知调用；回执 schema 已单独定义。
- N/A-05: 微信/RPA/Android/多端 UI/屏幕坐标/生产真机接缝——本 sprint 是 local_api Fleet 校验，不含终端 UI/RPA。
- N/A-06: smoke allowlist、feat+brain smoke、毕业测试入册、lint-tdd 顺序、Red commit 精确 add、共享 CI 默认禁区——本合同明确禁止修改共享 CI 与业务实现，仅新增 sprint 合同测试。
- N/A-07: dep-audit、客户 PII、secret 日志、部署 warning、生产 deploy root、PR CONFLICTING/auto-merge、controller merge/report——不在 Proposer 合同产物范围；secret 不进回执由 INV-05 覆盖。
- N/A-08: 退役代码、source inspection 替代 E2E、cortex learnings、付费 API 去重、自指探针、capture_atoms 查重——本 sprint 不涉及这些模块。
- N/A-09: 单 slot 串行与 subagent 写手约束——本角色单任务串行执行，未使用子代理。
- N/A-10: manual node `${}` expansion、解释器启动 exit code——本合同的 node 命令使用安全引号；所有 manual oracle 以真实 exit code 判定。
