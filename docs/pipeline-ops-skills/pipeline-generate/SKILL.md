---
name: pipeline-generate
description: /pipeline-generate — Content Pipeline Stage 4 (完整图生流程 = person-data + V6 渲染 + 拷 cards/) 的 task 执行 skill
---

# /pipeline-generate — Stage 4 图片生成完整流程

## 职责

**Stage 4 端到端出图**。三步：
1. **person-data 构造**：LLM 按 V6 字段预算把 findings → person-data.json
2. **V6 渲染**：node 脚本 gen-v6-person.mjs 把 person-data.json → 9 张 PNG（写到 `~/claude-output/images/`）
3. **拷贝 cards/**：把 PNG 拷到 `<output_dir>/cards/`（content-images HTTP 从这里读）

细粒度运维入口见 `/pipeline-persondata`（只修 person-data）和 `/pipeline-regen`（只 V6 渲染）。

## 前置检查

```bash
# 1. gen-v6-person.mjs 存在
ls ~/claude-output/scripts/gen-v6-person.mjs
# 2. findings 已就绪
OUT_DIR="<output_dir>"
ls "$OUT_DIR/../research/"*findings.json 2>/dev/null
```

## 介入步骤（一把梭）

```bash
KEYWORD="<关键词>"
python3 -c "
import sys
sys.path.insert(0, '/Users/administrator/perfect21/zenithjoy/services/creator')
from pipeline_worker.executors.generate import execute_generate
r = execute_generate({'keyword': '$KEYWORD', 'image_count': 9})
print(r)
"
```

成功后：
- `<output_dir>/person-data.json` 有 9 字段齐全的 JSON（`name` / `handle` / `headline` / `key_stats` / `flywheel` / `flywheel_insight` / `quote` / `timeline` / `day_schedule` / `qa`）
- `<output_dir>/cards/` 下 9 张 PNG（cover + 01-profile + 02-flywheel + 03-day + 04-qa + lf-01/02/03 + lf-cover）

## 分步介入（如果某一步挂了）

| 症状 | 走哪个子 skill |
|------|---------------|
| person-data.json 缺字段 / 含"待补充" | `/pipeline-persondata` |
| 9 张 PNG 没生成出来 / 文字溢出 | `/pipeline-regen` |
| PNG 生成了但 cards/ 里没拷进来 | 见下方"仅拷贝" |

### 仅拷贝 PNG 到 cards/（generate.py 最后一步独立跑）

```bash
python3 -c "
import sys
sys.path.insert(0, '/Users/administrator/perfect21/zenithjoy/services/creator')
from pathlib import Path
from pipeline_worker.executors.generate import _copy_v6_pngs_to_cards, _slug
keyword = '<关键词>'
out_dir = Path('<output_dir>')
n = _copy_v6_pngs_to_cards(_slug(keyword), out_dir)
print(f'copied {n} PNG to {out_dir}/cards/')
"
```

## 验收标准

```bash
OUT_DIR="<output_dir>"
echo -n "person-data.json: "
[ -f "$OUT_DIR/person-data.json" ] && echo "OK" || echo "MISSING"
echo -n "cards/ PNG 数: "
ls "$OUT_DIR/cards/"*.png 2>/dev/null | wc -l
```

期望：`person-data.json OK` + PNG 数 = 9

## 相关文件路径
- Executor: `services/creator/pipeline_worker/executors/generate.py`
- person_data_builder: `services/creator/pipeline_worker/person_data_builder.py`
- V6 脚本: `~/claude-output/scripts/gen-v6-person.mjs`
- V6 输出（硬编码）: `~/claude-output/images/`
- 最终 cards: `<output_dir>/cards/`

## LangGraph Contract

### Input（从 ContentPipelineState 读）
- `pipeline_id`: UUID
- `keyword`: 关键词
- `output_dir`: 产物根目录
- `findings_path`: 上游 research 产物
- `copy_path`: 上游 copywrite 产物（可选，某些 V6 会从 copy 摘金句填 quote 字段）
- `image_review_feedback` (可选): FAIL 回路时上一轮 vision 反馈（本节点可据此调整 BUDGET 或 person-data 策略）

### Output（写回 state）
- `person_data_path`: `<output_dir>/person-data.json`
- `cards_dir`: `<output_dir>/cards/`
- `trace`: "generate"
- `error`: null | 错误字符串

### 条件边（content-pipeline-graph 里定义）
- 无条件 → 进入 `image_review` 节点
- 如果是从 `image_review FAIL` 回来的（`image_review_round` > 0），本节点需要读 `image_review_feedback` 调整策略（收紧 BUDGET 或 prompt）。PR-3 接 docker 时在 skill prompt 里体现。

### 失败策略
- person_data_builder LLM 挂 → executor 内置硬截断 fallback，**不抛错**（有瑕疵的 person-data 总比无图强）
- V6 脚本 returncode != 0 → 抛错
- 拷贝 PNG 数 < 9 → 写 error 但仍返回（让 image_review 决定是否 FAIL）
