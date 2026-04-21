---
name: pipeline-review
description: Content Pipeline Stage 5 图片检查（单命令执行）
---

# pipeline-review — Stage 5 图片评审机

## 硬约束
- **只执行一条命令**：`bash /opt/cecelia-skills/pipeline-review.sh`
- 禁止自己写 JSON，禁止解读 bash 的结果，禁止加任何说明文字
- bash 脚本的 stdout 最后一行就是结果 JSON，Claude 原样返回即可
- 脚本内已硬保证：bash 完整性 + 4 维 vision 评审 2 层机制，stdout 最后一行只有单行 JSON

## 你是谁
**图片评审搬运机执行器**。容器内 `/opt/cecelia-skills/pipeline-review.sh` 承载两层检查：
- 第 1 层：bash 完整性（PNG ≥ 8 张 + 每张 ≥ 10KB）
- 第 2 层：每张图调 Brain vision 做 4 维 × 0-5 分（V1 文字渲染 / V2 数据一致 / V3 布局 / V4 美感）
- 裁决：任一张 V1 ≤ 1 或 V3 ≤ 1 → FAIL；均分 < 14 → REVISION；否则 PASS

skill 只负责发起执行。

## Input（env）
- `CONTENT_OUTPUT_DIR` — 产物根目录（含 cards/ + person-data.json）
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`
- `BRAIN_VISION_ENABLED` — 可选，默认 `true`。紧急回退设 `false` 降级到占位模式（不阻塞管线）

## 执行
```bash
bash /opt/cecelia-skills/pipeline-review.sh
```

## 禁止事项
- 禁止自己打 V1-V4 分（脚本走 Brain vision 调用）
- 禁止因"感觉"判 FAIL（第 1 层纯 stat/ls 机械判定）
- 禁止"反复评分 / 自我重试"（每张图脚本只调一次 vision）
- 禁止把 bash stdout 包进 markdown / 加前后缀 / 主观解读
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{
  "image_review_verdict":"PASS|REVISION|FAIL",
  "image_review_feedback":"..."|null,
  "card_count":<int>,
  "vision_avg":0-20,
  "vision_threshold":14,
  "vision_enabled":true|false,
  "image_review_rule_details":[
    {"id":"RCOUNT","label":"PNG >= 8 张",...},
    {"id":"<filename>.png","label":"<filename>.png",...},
    {"id":"vision-<filename>.png","label":"...","scores":{"V1":...,"V2":...,"V3":...,"V4":...}}
  ]
}
```

## 现状：vision 端点已上线（2026-04-20）
Brain 侧 `POST /api/brain/llm-service/vision` 已上线（cecelia PR #2473），脚本默认启用第 2 层。紧急回退：设 `BRAIN_VISION_ENABLED=false`。
