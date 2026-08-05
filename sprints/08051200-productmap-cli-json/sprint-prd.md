# Sprint PRD — product-map CLI 增加 --json 输出模式

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：以机器可解析的分类合同检查结果提升 CI 与 Brain 门禁可靠性；Brain 未提供量化增量，百分比待复盘确认。

## 背景

`scripts/product-map/cli.mjs` 的 `check` 子命令当前只提供人类可读文本，CI 与 Brain 解析 stdout 文本较脆弱。本 Sprint 为 product-map CLI 增加 `--json` 输出模式，同时保持既有调用完全兼容。

## Golden Path（核心场景）

运维/CI 从执行 `node scripts/product-map/cli.mjs check --json` 进入 → product-map CLI 完成既有分类合同检查并输出单个 JSON 对象 → 调用方用 `jq` 读取 `ok` 与 `errors`，并继续按退出码判定门禁结果。

具体：
1. 运维/CI 执行 `check --json`；stdout 仅产生一个合法 JSON 对象。
2. 检查通过时，调用方观察到 `ok` 为 `true`、`errors` 为空数组且退出码为 0。
3. 检查失败时，调用方观察到 `ok` 为 `false`、`errors` 含具体问题且退出码非 0。
4. 运维/CI 不带 `--json` 执行 `check` 时，输出与当前版本逐字一致，退出码语义不变。

## 边界情况

- `product-map.json` 不存在或不可解析时，`--json` 的 stdout 仍是单个合法 JSON 对象，`ok=false` 且 `errors` 含原因，不出现未捕获异常文本。
- `--json` 与既有参数并存时，不改变其他参数的原有语义。
- 多个检查问题同时存在时，`errors` 为字符串数组并逐项承载具体问题。

## 范围限定

**在范围内**：`scripts/product-map/` 下 `check --json` 的用户可见行为、退出码兼容性及其单元/smoke 验收。

**不在范围内**：修改 `product-map/product-map.yaml` 或生成的分类数据；修改其他子命令行为；修改共享 CI 工作流。

## 假设

- [ASSUMPTION: “输出与现在逐字一致”以冻结基线上的既有 `check` stdout 为比较基准。]
- [ASSUMPTION: `errors` 中每项只约束为可理解的具体问题字符串，不在本 Sprint 固定错误码或排序合同。]
- [ASSUMPTION: task payload 未提供 Golden Path step_id，因此使用 `none（PrepPRD 未锚定）`。]

## 预期受影响文件

- `scripts/product-map/cli.mjs`：承载 product-map CLI `check --json` 的用户可见入口行为。
- `scripts/product-map/` 下既有 CLI 测试文件：覆盖 JSON 成功、JSON 失败、异常输入、退出码及非 JSON 向后兼容。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；两源均为空 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Node.js 20（当前执行环境）
- 可观测: stdout 在 `--json` 模式下必须保持机器可解析；具体错误通过 `errors` 暴露。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 为空，area 源按 id 去重。与本 Sprint 直接相关的有效铁律如下。 -->
- [共享CI禁区] 未经合同显式授权不得修改 `.github/workflows/*.yml` 等跨 Sprint 共享判定文件（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: Journey bb50964c-f8f7-4843-87da-7148a2611d80；done/working ability 查询为空 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本。
# 期望验收点：执行 product-map `check --json` 后可用 jq 读取 ok/errors，成功与失败退出码保持原语义；不带 --json 的 stdout 与冻结基线逐字一致；缺失或损坏输入仍只输出合法 JSON。
```

## journey_type: dev_pipeline
## journey_type_reason: 该行为是供 CI 与 Brain 消费的仓库开发门禁 CLI，不是终端用户界面。
## target_environment: local_api
## target_environment_reason: zenithjoy 仓库中的非 UI Node.js CLI 在本地 evaluator 执行，无 Windows、微信、生产服务器或浏览器依赖。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: none（PrepPRD 未锚定）
