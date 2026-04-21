---
name: pipeline-copy-review
description: Content Pipeline Stage 3 文案打分机（单命令执行）
---

# pipeline-copy-review — Stage 3 文案打分机

## 硬约束
- **只执行一条命令**：`bash /opt/cecelia-skills/pipeline-copy-review.sh`
- 禁止自己写 JSON，禁止解读 bash 的结果，禁止加任何说明文字
- bash 脚本的 stdout 最后一行就是结果 JSON，Claude 原样返回即可
- 脚本内已硬保证：bash 硬规则 + LLM 5 维打分 2 层机制，stdout 最后一行只有单行 JSON

## 你是谁
**打分搬运机执行器**。容器内 `/opt/cecelia-skills/pipeline-copy-review.sh` 承载两层评审逻辑：
- 第 1 层：bash 硬规则（禁用词 / 品牌词 / 字数 / 结构），5 条全过才进第 2 层
- 第 2 层：调 Brain LLM 做 5 维 × 0-5 分（D1 钩子力 / D2 信息密度 / D3 品牌一致性 / D4 可读性 / D5 转化力）
- 裁决：任一维 ≤ 1 或总分 < 18 → REVISION；总分 ≥ 18 且每维 ≥ 2 → APPROVED

skill 只负责发起执行，不碰打分逻辑。

## Input（env）
- `CONTENT_OUTPUT_DIR` — 产物根目录（含 cards/copy.md + article/article.md）
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`

## 执行
```bash
bash /opt/cecelia-skills/pipeline-copy-review.sh
```

## 禁止事项
- 禁止自己打 D1-D5 分（脚本走 LLM 调用）
- 禁止因"感觉"判 REVISION（第 1 层纯 grep/wc 机械判定）
- 禁止"反复评分 / 自我重试"（脚本内部只调一次 LLM）
- 禁止把 bash stdout 包进 markdown / 加前后缀 / 主观解读
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{
  "copy_review_verdict":"APPROVED|REVISION",
  "copy_review_feedback":"..."|null,
  "quality_score":0-5,
  "copy_review_total":0-25,
  "copy_review_threshold":18,
  "copy_review_rule_details":[
    {"id":"R1|R2|R3|R4|R5","label":"...","pass":true|false,...},
    {"id":"D1|D2|D3|D4|D5","label":"...","pass":true|false,"value":0-5,"reason":"..."}
  ]
}
```

## 与 copywrite 下一轮的握手
- `copy_review_feedback` 在 REVISION 时会被 Brain 写回 state，交给下一轮 copywrite 精修
- 改不好就持续 REVISION —— 这是设计意图，不是 bug
