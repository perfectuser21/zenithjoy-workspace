---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Kernel acquisition effective-config guard v2 显式恢复

**范围**: PR #1581 精确 SHA 的 Evaluator + Independent Judge 双重验收与 fail-closed merge-ready 信号；不修改产品代码、不 merge。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `contract-draft.md` 固定 PR #1581、目标 SHA、冻结 Red SHA、真实 local_api E2E 与双角色结果 schema
  Test: node -e "const c=require('fs').readFileSync('sprints/08030535-kernel-acquisition-config-recovery-bb102e83/contract-draft.md','utf8');for(const x of ['c305f6217da65bb69413c39e621b7e797e0fb189','b937e1d39a81c4a46d06a83a84886facb79d7ba2','Independent Judge','## E2E 验收'])if(!c.includes(x))process.exit(1)"

- [ ] [ARTIFACT] TDD Red 测试逐字段约束 Evaluator、Judge 与 merge-gate 三份证据
  Test: node -e "const c=require('fs').readFileSync('sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts','utf8');for(const x of ['evaluator.json','independent-judge.json','merge-gate.json','candidate_sources_read'])if(!c.includes(x))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 恢复入口锁定 PR #1581 精确 SHA 且尚未合并 [接缝×2]
  动作: 真调 GitHub API 读取 PR #1581 的 state、headRefOid 与 mergeCommit，并比对共享 Red fixture
  预期观察: PR 为 OPEN、head 精确等于 c305f6217da65bb69413c39e621b7e797e0fb189、mergeCommit=null、fixture 零 diff
  等待预算: 30s
  留证: gh JSON、git diff exit code 与实际 head SHA
  Test: manual:bash -c 'RESP=$(gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json state,headRefOid,mergeCommit); echo "$RESP" | jq -e '"'"'.state=="OPEN" and .headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .mergeCommit==null'"'"' >/dev/null; git diff --exit-code b937e1d39a81c4a46d06a83a84886facb79d7ba2 c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts'

- [ ] [BEHAVIOR] [L2] B-02: Evaluator 对 target SHA 的真实 local_api 行为验收通过 [接缝×2]
  动作: 在 target SHA worktree 对 attempt 空库跑 migration，真实 signup 双租户并执行 effective-config guard，再读取 Evaluator 结果
  预期观察: 非法更新 400 INVALID_CONFIG 且零写入；合法路径隔离；Evaluator PASS 并逐层锚定 target SHA
  等待预算: 180s
  留证: migration/API/Vitest 日志、HTTP body、DB 时间窗查询与 evaluator.json
  Test: manual:bash -c 'RECOVERY_EVIDENCE_DIR="${RECOVERY_EVIDENCE_DIR:?}" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts -t "Evaluator 结构化结论锚定目标 SHA 且行为证据全部通过"'

- [ ] [BEHAVIOR] [L2] B-03: Independent Judge 独立复核同一 SHA 且无其他 candidate 输入 [接缝×2]
  动作: Judge 在 Evaluator 后独立复核 target SHA 证据，controller 将其结构化结果写入独立文件
  预期观察: Judge PASS、independent=true、candidate_sources_read=[]，顶层与 behavior 证据完整且 anchor SHA 精确一致
  等待预算: 300s
  留证: independent-judge.json、Judge exit code 与 log_tail
  Test: manual:bash -c 'RECOVERY_EVIDENCE_DIR="${RECOVERY_EVIDENCE_DIR:?}" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts -t "Independent Judge 独立结论锚定同一目标 SHA 且未读取其他 candidate"'

- [ ] [BEHAVIOR] [L2] B-04: 双结论齐备且 SHA 一致后才发 merge-ready 信号 [接缝×2]
  动作: 对账 evaluator.json、independent-judge.json 与 merge-gate.json，随后再次真查 GitHub PR 状态
  预期观察: 三个 SHA 完全相同且双 PASS 时 merge_ready=true；PR 仍 OPEN 且 mergeCommit=null，本 Sprint 不执行 merge
  等待预算: 30s
  留证: 三份 JSON、第二次 gh JSON 与命令 exit code
  Test: manual:bash -c 'RECOVERY_EVIDENCE_DIR="${RECOVERY_EVIDENCE_DIR:?}" npx vitest run sprints/08030535-kernel-acquisition-config-recovery-bb102e83/tests/recovery-evidence-contract.test.ts -t "双结论一致后才产生精确 SHA 的可合并信号"; RESP=$(gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json state,headRefOid,mergeCommit); echo "$RESP" | jq -e '"'"'.state=="OPEN" and .headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .mergeCommit==null'"'"''

## Invariant 映射

- INV-1：B-02 以真 API/Postgres 交叉验证；未覆盖项不得冒充全链路。
- INV-2：migration、应用与查询统一使用 Fleet 注入的 `DB_URL`/`DATABASE_URL`。
- INV-3 N/A：不触及 agents 表。
- INV-4 N/A：不新增状态枚举。
- INV-5 N/A：本任务不是 watchdog_overdue 恢复。
- INV-6：B-02 同时检查 HTTP 语义字段与 DB 零写入/隔离。
- INV-7 N/A：不改依赖或 advisory 白名单。
- INV-8 N/A：无 headed relay 长等待。
- INV-9：任何测试入册变更须先跑现有 lint-tdd-commit-order 与 check-test-coverage 门禁。
- INV-10：Red 与全部 manual oracle 记录真实解释器 exit code。
- INV-11 N/A：无 manual node 模板表达式。
- INV-12：B-02 真跑 effective-config smoke，失败非零。
- INV-13：B-01 机械确认共享 Red fixture 相对冻结提交零变更。
- INV-14 N/A：无周期多轮扫描。
- INV-15 N/A：无外部付费调用。
- INV-16 N/A：不新增跨模块时间常数。
- INV-17：合同使用真实所需 local_api，不含 Android 假设。
- INV-18：payload 与合同均明确 target_environment=local_api。
- INV-19：Judge 文件必须有顶层 exit_code/log_tail/behavior_tests，逐项 exit_code/log_tail。
- INV-20 N/A：不写有限长 DB 字段。
- INV-21 N/A：不复活退役产品功能。
- INV-22：所有 false/缺失/无效结果显式 fail-closed。
- INV-23：任一 smoke 或角色失败必须非零，不吞错。
- INV-24 N/A：不修改 journey_features report。
- INV-25：Harness 完成核验 merge-gate 与 PR 未合并产物，不只看容器退出码。
- INV-26 N/A：不新增 host 或环境白名单。
- INV-27 N/A：不创建 headed relay payload。
- INV-28 N/A：不做功能退役判断。
- INV-29：bridge/API/角色结果错误不得吞掉，必须非零并保留 log_tail。
- INV-30 N/A：不新建或复用业务表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不涉及多 OS/device_platform UI。
- INV-33：Evaluator、Judge、merge-gate 统一采用精确 SHA + 双 PASS 语义。
- INV-34：B-01/E2E 用 `git rev-parse --verify "<ref>^{commit}"` 核实 ref。
- INV-35：target worktree 只接触 attempt DB，且真实 signup 产生临时主体。
- INV-36：部署/bridge/API 失败均非零，不降级 warning。
- INV-37 N/A：不做部署版本判变。
- INV-38：B-02 真异步启动 app、真 HTTP 与真 DB，不以源码读取替代行为。
- INV-39：Test Contract 固定四列且路径使用反引号。
- INV-40：Red commit 只暂存本 Sprint 精确测试路径。
- INV-41：GitHub↔target、API↔DB、Evaluator↔Judge 接线均真验。
- INV-42 N/A：不新增 cron。
- INV-43：Generator/本 Sprint 禁止 merge，只报告 merge-ready。
- INV-44 N/A：不依赖 headed tmux 上下文。
- INV-45：只核对本次 PR #1581/target SHA，不复用其他 candidate 结果。
- INV-46：不修改共享 CI 基础设施判定文件。
- INV-47：B-04 明确双 verdict 前后均查未 merge。
- INV-48：所有 smoke 错误传播非零。
- INV-49 N/A：不修改 brain 源码。
- INV-50 N/A：不新增 task_type。
- INV-51：目标 API 常驻性由进程存活与 `/health` 端口响应双信号确认。
- INV-52 N/A：不新增美国 Mac mini 宿主服务。
- INV-53 N/A：不新增常驻宿主服务，无 launchd-patrol 登记变化。
- INV-54：B-01 至 B-04 均为可机检 smoke 铁律，失败非零。
- INV-55：本会话只执行当前 proposer 角色。
- INV-56：端口可由环境覆盖，其余值来自 GitHub/API/DB 实测。
- INV-57：三项接缝真验前为 logic-done-pending。
- INV-58：B-02 真实 signup A/B 并断言 tenant 不同与写入隔离。
- INV-59：凭据只由运行时注入，不进 Git/日志。
- INV-60：临时邮箱无真实 PII，日志不输出 cookie/token。
- INV-61：业务请求沿用真实 better-auth signup/session 鉴权。
- INV-62：A/B cookie 只访问自身 tenant，DB 交叉验证无跨租户修改。
