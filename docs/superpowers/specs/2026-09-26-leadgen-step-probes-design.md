# social-keyword-leadgen 声明式探针文件（棒2 workspace 侧）设计

决策 702949b6 / e2cef2c9。Brain 任务 ddf3fe8d。

## 目标

把 v4 delivery 里 `readback_verified:0` 的硬编码（`batch2-v4.sh:68/70/74`）变成一份声明式探针文件（同 dbt tests / Dagster asset checks）：写完读回的断言由 YAML 描述，Brain 侧（cecelia 仓 `scripts/sync-step-probes.mjs`）登记哈希并把 journey cell 的 `assertion_ref` 写成 `probe:<key>`。本 PR 只做 zenithjoy-workspace 侧：探针文件 + schema + 单测 + README。

## 文件

| 文件 | 职责 |
|---|---|
| `services/phone-adb-controller/checks/social-keyword-leadgen.yaml` | 探针 SSOT，`version: 1`，`workflow: social-keyword-leadgen`，5 条探针 |
| `services/phone-adb-controller/checks/schema.json` | JSON Schema（draft-07 子集）：stage / op / severity 枚举，`ref` 形状 |
| `services/phone-adb-controller/checks/probes-lib.js` | 零依赖：受限 YAML 子集解析 + JSON Schema 子集校验 + `loadChecks()` + 从 `workflow-result.sh` 抽闭集键 |
| `services/phone-adb-controller/__tests__/checks-social-keyword-leadgen.test.mjs` | node:test 守卫（CI `openclaw-scripts-test` 无条件跑，不装依赖） |

## 探针形状

```yaml
- key: <snake_case 唯一>
  stage: preflight|discovery|qualification|collection|scoring|delivery|cleanup
  journey_cell: "stage:<同 stage>"
  probe:
    type: sql            # target: pg_zenithjoy，query 为 SQL，占位 $RUN_TAG/$LINE_KEY/$WORD
    # 或
    type: http           # target: feishu_jinuo|feishu_yuesheng；url + filter(列=值) + reduce(count|field:<列>)
                         # 可选 minus: {url, filter, reduce} —— 结果 = 主查询 - minus
  expect: {op: ">="|"=="|"<=", value: <number>} | {op: ..., ref: "metrics.<闭集键>"} | {op: not_null_all}
  severity: warn|error
  note: 依据 文件:行
```

闭集键 = `workflow-result.sh` `req_keys()` 七个 stage 的键并集 + COMMON 四个；测试运行时从脚本文本抽取，YAML 里的 `ref` 引了不存在的键就红。

## 五条探针（首发全 warn）

| key | stage | 取法 | 期望 |
|---|---|---|---|
| videos_readback | delivery | PG `leadgen_videos` where `harvest_batch=$RUN_TAG` 计数 | `>= metrics.videos_processed`（collection 阶段各词工件求和） |
| comments_readback | delivery | 飞书原始评论池 `运行批次=$RUN_TAG` 计数 | `>= metrics.leads_written` |
| line_key_not_null | delivery | PG `leadgen_videos` 本批 `line_key` 列 | `not_null_all` |
| pool_advanced | scoring | 飞书原始评论池 `运行批次=$RUN_TAG` 且 `处理状态=待分拣` 计数 | `<= 0` |
| effective_count | scoring | 关键词表 `有效线索数`（$WORD）减 评论池 `进入最终线索=true` 且 `命中关键词=$WORD` 计数 | `== 0` |

评论只落飞书不落 PG（`push-raw-comments.js` 不 require `leadgen-db-lib`），所以 comments_readback 走 http；视频双写（`push-videos.js:11-12,56`），走 sql。

## 测试策略

integration 档：真 YAML 文件 + 真 schema + 真 `workflow-result.sh` 文本。断言：schema 通过；key 唯一；journey_cell == `stage:<stage>`；`ref` ∈ 闭集键；http 探针 filter/reduce 齐全；故意构造坏 stage / 坏 op / 坏 ref 的文档必被拒（proven-to-fire）。
