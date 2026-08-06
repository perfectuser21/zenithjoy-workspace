---
skeleton: false
journey_type: autonomous
---
# Contract DoD — product-map CLI `check --json`

**范围**: 仅 `scripts/product-map/` 下 CLI 与单测；不改数据、其他子命令或 CI。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/product-map/cli.mjs` 实现 JSON 模式且单测位于 PRD 允许的 `scripts/product-map/` 范围
  Test: node -e "const fs=require('fs');const cli=fs.readFileSync('scripts/product-map/cli.mjs','utf8');if(!cli.includes('--json')||!fs.existsSync('scripts/product-map/__tests__/product-map-cli-json.test.js'))process.exit(1)"
- [ ] [ARTIFACT] 只修改 PRD 允许的 CLI/测试范围
  Test: bash -c 'git diff --name-only 6669497377b163ab7a8f4b40742b3f238d6d5538...HEAD | grep -Ev "^(scripts/product-map/|sprints/08061215-productmap-cli-json-r42/)" && exit 1 || exit 0'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: JSON 成功结论可被调用方直接解析
  动作: 在真实隔离 product-map 副本执行 `check --json`
  预期观察: stdout 仅有 `{ok:true,errors:[]}`，stderr 为空且退出码 0
  等待预算: 5s
  留证: node:test TAP 中 `成功时只输出` 子测试输出
  Test: manual:bash -c 'node --test --test-name-pattern="成功时只输出" sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-02: 缺失生成 JSON 返回结构化失败
  动作: 删除隔离副本的 `product-map.json` 后执行 `check --json`
  预期观察: stdout 是 `ok=false` 的单个 JSON，errors 含缺失原因，进程非零且无 stderr
  等待预算: 5s
  留证: node:test TAP 中 `缺少 product-map.json` 子测试输出
  Test: manual:bash -c 'node --test --test-name-pattern="缺少 product-map.json" sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-03: 损坏生成 JSON 不泄漏裸异常
  动作: 将隔离副本的 `product-map.json` 写成不可解析内容后执行 `check --json`
  预期观察: stdout 是 `ok=false` 的合法 JSON，errors 含 parse/JSON 原因，进程非零且 stderr 为空
  等待预算: 5s
  留证: node:test TAP 中 `不可解析 product-map.json` 子测试输出
  Test: manual:bash -c 'node --test --test-name-pattern="不可解析 product-map.json" sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-04: 多个检查问题被完整聚合
  动作: 在同一隔离副本同时制造 digest 不一致、Markdown digest 不一致与 smoke file 缺失
  预期观察: stdout 的严格失败对象中 errors 至少三项，并分别描述三个真实问题
  等待预算: 5s
  留证: node:test TAP 中 `多个检查问题` 子测试输出
  Test: manual:bash -c 'node --test --test-name-pattern="多个检查问题" sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-05: 默认文本输出零回归
  动作: 在同一真实隔离副本执行不带 `--json` 的 `check`
  预期观察: stdout 与当前 PASS 文本（含 digest 与换行）逐字一致，退出码 0
  等待预算: 5s
  留证: node:test TAP 中 `不带 --json` 子测试输出
  Test: manual:bash -c 'node --test --test-name-pattern="不带 --json" sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-06: JSON 标志只作用于 check 且不干扰既有命令参数
  动作: 分别执行 `check --json` 与既有 `validate --json` 命令形态
  预期观察: check 返回严格成功 JSON；validate 仍返回既有人类文本与退出码
  等待预算: 5s
  留证: node:test TAP 中 `既有命令参数` 子测试输出
  Test: manual:bash -c 'node --test --test-name-pattern="既有命令参数" sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js'

## Invariant 覆盖

- [铁律01] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律02] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律03] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律04] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律05] 适用：contract-draft 的 Test Contract 保持固定四列表格。
- [铁律06] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律07] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律08] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律09] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律10] 适用：B-01 至 B-06 是本 Sprint smoke；按 PRD 范围保留在 `scripts/product-map/` 单测体系，不修改范围外 registry。
- [铁律11] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律12] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律13] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律14] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律15] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律16] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律17] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律18] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律19] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律20] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律21] 适用：push 前执行 product-map:check 与定向测试；本 Sprint 范围明确排除范围外 registry 变更。
- [铁律22] 适用：B-01 至 B-06 是本 Sprint smoke。
- [铁律23] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律24] 适用：B-01 至 B-06 是本 Sprint smoke。
- [铁律25] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律26] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律27] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律28] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律29] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律30] 适用：JSON 成功/失败均检查 ok 与 errors 语义字段，不只看退出码。
- [铁律31] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律32] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律33] 适用：测试从隔离副本读取真实 digest，不写死环境值。
- [铁律34] 适用：B-01 至 B-06 是本 Sprint smoke。
- [铁律35] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律36] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律37] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律38] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律39] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律40] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律41] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律42] 适用：Red commit 只精确暂存 Sprint 合同测试与合同产物。
- [铁律43] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律44] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律45] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律46] 适用：测试真执行本次 cli.mjs check 路径，不复用历史合同替代。
- [铁律47] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律48] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律49] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律50] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律51] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律52] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律53] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律54] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律55] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律56] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律57] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律58] 适用：所有 node 命令已用目标 Node 真跑并留 Red 证据。
- [铁律59] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律60] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律61] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律62] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律63] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律64] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律65] 适用：ok=false 必须伴随具体 errors 与非零退出码。
- [铁律66] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律67] 适用：批准前逐条运行五个 manual oracle 并记录退出码。
- [铁律68] N/A：本 Sprint 仅改本地只读 CLI 输出与单测，不触及该铁律对应的服务、DB、调度、真机、部署或外部系统。
- [铁律69] 适用：target_environment 使用 Brain payload 指定的 local_api。
