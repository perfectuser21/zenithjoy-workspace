---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

## ARTIFACT 条目

- [ ] [ARTIFACT] `validate-fleet-payload.mjs` 提供真实 JSON 输入、GitHub evidence 与 GP SSOT 校验，且不修改共享 CI 文件。
  Test: node -e "const fs=require('fs');const p='sprints/08051905-kernel-pr1581-fleet-validation-r39/validate-fleet-payload.mjs';const c=fs.readFileSync(p,'utf8');if(!c.includes('payload_invalid')||!c.includes('environment_failure'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 输出绑定同一 PR head 的完整结论 [接缝×2]
  动作: 以真实 `gh pr view 1581` 证据执行 Fleet payload 校验器
  预期观察: 输出 `ok:true` 且仓库、target SHA、GP anchor、base SHA 逐字一致
  等待预算: 30s
  留证: 命令 stdout JSON 与 GitHub evidence JSON
  Test: manual:bash -c 'D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-b01.XXXXXX"); trap "rm -rf $D" EXIT; jq -n '"'"'{base_repo:"perfectuser21/zenithjoy-workspace",target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",gp_anchor:"line02/keyword_acquisition#step7"}'"'"' > "$D/p.json"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,baseRefOid > "$D/e.json"; node sprints/08051905-kernel-pr1581-fleet-validation-r39/validate-fleet-payload.mjs --payload "$D/p.json" --evidence "$D/e.json" | jq -e '"'"'.ok==true and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'"'"''

- [ ] [BEHAVIOR] [L2] B-02: 缺失 base_repo 时拒绝成功结论
  动作: 删除 payload 的 `base_repo` 后执行校验器
  预期观察: 命令非零退出并报告 `payload_invalid`，不输出 `ok:true`
  等待预算: 5s
  留证: stderr/stdout 失败分类
  Test: manual:bash -c 'D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-b02.XXXXXX"); trap "rm -rf $D" EXIT; jq -n '"'"'{target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",gp_anchor:"line02/keyword_acquisition#step7"}'"'"' > "$D/p.json"; jq -n '"'"'{headRefOid:"c305f6217da65bb69413c39e621b7e797e0fb189",baseRefOid:"676fed7de12023d355deac7849af8a525ae53f8d"}'"'"' > "$D/e.json"; if node sprints/08051905-kernel-pr1581-fleet-validation-r39/validate-fleet-payload.mjs --payload "$D/p.json" --evidence "$D/e.json" >"$D/o" 2>&1; then exit 1; fi; grep -q payload_invalid "$D/o" && ! grep -q '"'"'"ok":true'"'"' "$D/o"'

- [ ] [BEHAVIOR] [L2] B-03: target_head_sha 与 PR head 不一致时拒绝且不回退工作区 HEAD [接缝×2]
  动作: 传入另一个完整 SHA，同时保留真实 PR #1581 evidence
  预期观察: 命令非零退出并报告 `payload_invalid`
  等待预算: 30s
  留证: GitHub evidence 与失败分类
  Test: manual:bash -c 'D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-b03.XXXXXX"); trap "rm -rf $D" EXIT; jq -n '"'"'{base_repo:"perfectuser21/zenithjoy-workspace",target_head_sha:"a9a32c00029b3e6cf6d22e2d71dfa6eb209c50ef",gp_anchor:"line02/keyword_acquisition#step7"}'"'"' > "$D/p.json"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,baseRefOid > "$D/e.json"; if node sprints/08051905-kernel-pr1581-fleet-validation-r39/validate-fleet-payload.mjs --payload "$D/p.json" --evidence "$D/e.json" >"$D/o" 2>&1; then exit 1; fi; grep -q payload_invalid "$D/o"'

- [ ] [BEHAVIOR] [L2] B-04: gp_anchor 缺失或不能唯一解析 Step 7 时拒绝
  动作: 将锚点改为不存在的 `step07` 并执行校验器
  预期观察: 命令非零退出并报告 `payload_invalid`，不猜测 `step7`
  等待预算: 5s
  留证: 失败分类与 product-map 精确查询输出
  Test: manual:bash -c 'D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-b04.XXXXXX"); trap "rm -rf $D" EXIT; jq -n '"'"'{base_repo:"perfectuser21/zenithjoy-workspace",target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",gp_anchor:"line02/keyword_acquisition#step07"}'"'"' > "$D/p.json"; jq -n '"'"'{headRefOid:"c305f6217da65bb69413c39e621b7e797e0fb189",baseRefOid:"676fed7de12023d355deac7849af8a525ae53f8d"}'"'"' > "$D/e.json"; if node sprints/08051905-kernel-pr1581-fleet-validation-r39/validate-fleet-payload.mjs --payload "$D/p.json" --evidence "$D/e.json" >"$D/o" 2>&1; then exit 1; fi; grep -q payload_invalid "$D/o"'

## Invariant 覆盖

- INV-01 本机常驻服务：N/A，本 sprint 不安装服务。
- INV-02 status 枚举：N/A，本合同无 task status 新值。
- INV-03 共享 CI 默认禁区：[ARTIFACT] 明确不修改 workflow/smoke allowlist。
- INV-04 同语义一致：target SHA 在 payload、GitHub、结论三处严格相等。
- INV-05 Test Contract 四列：contract-draft 表为固定四列且 test file 使用反引号。
- INV-06 表名冲突/后台 job/cron/租户 DB：N/A，本 sprint 不建表、不建 job、不碰租户数据。
- INV-07 提前 merge 完整性：PR head OID 必须等于结论 target SHA。
- INV-08 git ref 校验：使用 `git rev-parse --verify "<ref>^{commit}"`。
- INV-09 服务双信号/launchd：N/A，不涉及服务存活。
- INV-10 headed payload：权威字段来自 payload，分支不充当目标来源。
- INV-11 时间常数/心跳：N/A，无跨模块时间常数或 relay wait loop。
- INV-12 evaluator 临时文件：所有脚本用 session 独享 `mktemp -d`。
- INV-13 真机/生产接缝：GitHub/Git 接缝真验；不涉及真机。
- INV-14 catch/部署失败：任一外部依赖失败均非零退出，无 warning 降级。
- INV-15 secrets/PII：不硬编码、不打印 token；payload 无客户数据。
- INV-16 auth/双租户：N/A，不新增 API 或租户数据路径。
- INV-17 watchdog/scheduler/通知：N/A，不触及相关模块。
- INV-18 判变生产实体：以 GitHub PR `headRefOid` 对账，不用工作区 diff。
- INV-19 target_environment：PRD payload 已指定 `local_api`，合同一致。
- INV-20 Red commit：仅新增本 sprint 精确测试及合同路径。
- INV-21 单 slot 串行：task-plan 仅 ws1。
- INV-22 输入失败返回 false/null：校验器失败必须显式非零，不依赖异常猜测。
- INV-23 manual oracle：Red 与自查记录真实 exit code和 Node 解释器。
- INV-24 DB 连接一致：本 sprint 无业务 DB 写/读，N/A。
- INV-25 validation identity：全部 late-bound，合同无角色 UUID 字面量。
- INV-26 其余铁律（Android/RPA/UI、多端、付费 API、表字段长度、退役、自产探针、report/merge 权限）：均不触及对应模块，N/A。

