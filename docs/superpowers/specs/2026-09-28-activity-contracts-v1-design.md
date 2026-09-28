# 主干活动契约第一棒 —— 设计（决策 3240824c / f18f56b8，任务 5b4605eb）

## 目标

把「关键词获客」（product-map 能力 `keyword_acquisition`）的 8 个主干活动写成 15 字段契约，
与能力地图同处同校验；8 个活动的后置条件全部挂拦截级（`severity: error`）探针；
无契约的步骤/阶段进不了工作流（CI 红）；验收 = 「对标链接获客」（`benchmark_link_acquisition`）
只替换「发现」一个活动即组装成功。

## 主理人拍板（决策 f18f56b8）

1. 契约按**设计顺序**：预检 → 发现 → 判定 → 采集 → 评分 → 配送 → 触达 → 归位（判定合格才采集）。
   代码现状「落池后才判定」（PR #1964 接线挂在 batch2.sh 末尾）属偏差，纠正走任务 8bb3af55。
2. 每个活动后置条件一律拦截，不设 warn / 观察期；缺探针当棒补齐。
3. 步骤 key = `能力.活动.步骤`，全 snake_case，不带序号；顺序存 `order`，中文存 `name`。
4. 本棒只产出契约哈希进生成物；运行时核哈希并入 9883924e。

## 落点

| 文件 | 作用 |
|---|---|
| `product-map/contracts/object-types.yaml` | 对象类型表：身份键 + 正本位置 + 字段 |
| `product-map/contracts/activity-contract.schema.json` | 契约格式（JSON Schema 2020-12，Ajv strict，同 product-map.schema.json） |
| `product-map/contracts/keyword_acquisition.yaml` | 8 活动契约 + 步骤 |
| `product-map/contracts/benchmark_link_acquisition.yaml` | 引用 7 个活动 + 自有「对标发现」活动 |
| `scripts/product-map/contracts-lib.mjs` | 加载 / schema 校验 / 交叉校验 / 组装 / 哈希 |
| `product-map/generated/contracts.json` | 生成物：每能力、每活动的 sha256，`product-map:check` 查漂移 |
| `services/phone-adb-controller/checks/*` | 探针全部升 error；补 preflight/discovery/qualification/collection/outreach/cleanup 探针；新增 `metric` 探针类型与 `outreach` stage |

## 契约 15 字段（活动级）

身份：`key` `version`+`compatibility` `owner`；接口：`inputs` `outputs` `preconditions` `postconditions`；
运行：`execution` `budget` `resources` `idempotency` `failure`；边界：`side_effects` `invokers` `model`。
另有 `name` `order` `steps` `known_gaps`。

- `failure` 闭集四类 `empty_ok / retryable / needs_human / fatal`；`needs_human` 必须带 `alert`。
- `postconditions[].probe` 必须存在于能力的 checks YAML，stage 与活动 key 一致且 `severity: error`。
- 步骤 `steps[]`：`key` `name` `order` `reads` `writes`（`Type.field`）`check`（确定性断言，必填）`implementation`（`implemented|missing` + `ref`）`uses_llm`。
- 任一步骤 `uses_llm: true` → 活动必须有 `model`。

## 组装规则（= 无契约不得进工作流的闸）

1. 能力 id 必须在 `product-map.yaml`。
2. 活动 `ref: <能力>.<活动>` 引用别处契约，原样复用。
3. 按 `order` 串：每个活动的 `inputs` 类型 ⊆ 能力 `trigger_inputs` ∪ 前序活动 `outputs`，否则组装失败。
4. 步骤 `reads` 的类型 ⊆ 本活动 inputs ∪ 本活动前序步骤 writes；`writes` 的类型 ⊆ 本活动 outputs。
5. `workflow-result.sh req_keys()` 的每个 stage、checks YAML 的每个 stage 都必须有同名活动契约。
6. 任何一条不满足 → `test:product-map` 红（CI `product-map-contract` job）。

## 如实缺口（写进契约 known_gaps，不伪装）

- 执行顺序未纠正（8bb3af55）；preflight/cleanup 指标为常量、outreach 不在账本、只有 delivery/scoring 运行时读回（6b133a81）。
  这些活动的探针在运行时接线前会如实判红。
- 对标发现活动步骤 `implementation: missing`：本棒验收是契约组装成功，不是真机跑通。

## 测试策略

- unit（node --test，挂 `test:product-map`）：schema 正例；逐条反例（缺 postcondition、探针 warn、输入类型断链、
  步骤无 check、req_keys 阶段无契约、llm 步骤无 model、needs_human 无 alert）；对标链接组装成功；
  删一个活动契约 → 组装失败（proven-to-fire）；哈希稳定。
- checks 测试（`openclaw-scripts-test`）改钉：全部 error、新 metric 类型、outreach stage。
- verify-step 单测：metric 探针从 `--metrics-json` 读值。
