---
name: pipeline-copy-review
description: /pipeline-copy-review、审文案、文案质检 — Content Pipeline Stage 3 (文案品牌审查) 运维 skill
---

# /pipeline-copy-review — Stage 3 文案审查 skill

## 什么时候用
- copywriting 产出的 copy.md / article.md 要做品牌对齐 + 禁用词检查
- 手动复审某条 pipeline 的文案质量
- 想给 LangGraph 节点做 APPROVED/REVISION 的裁决

## 审查维度

1. **品牌关键词命中**：文案中是否包含 `能力` / `系统` / `一人公司` / `小组织` / `AI` / `能力下放` / `能力放大` 中至少 1 个
2. **禁用词**：不应出现 `coding` / `搭建` / `agent workflow` / `builder` / `Cecelia` / `智能体搭建` / `代码部署`
3. **长度**：
   - `copy.md`（社交文案）≥ 200 字
   - `article.md`（公众号长文）≥ 500 字
4. **LLM 品牌符合度**（可选）：调 thalamus LLM 打分，有 feedback 写进 copy_review_feedback

## 前置检查

```bash
OUT_DIR="<output_dir>"
[ -f "$OUT_DIR/cards/copy.md" ] && wc -c "$OUT_DIR/cards/copy.md"
[ -f "$OUT_DIR/article/article.md" ] && wc -c "$OUT_DIR/article/article.md"
```

## 介入步骤

### 步骤 1：跑程序化检查

```bash
python3 -c "
import sys
sys.path.insert(0, '/Users/administrator/perfect21/zenithjoy/services/creator')
from pipeline_worker.executors.copy_review import execute_copy_review
r = execute_copy_review({'keyword': '<关键词>'})
print(f\"passed={r['review_passed']}, score={r['quality_score']}, issues:\")
for i in r.get('issues', []):
    print(' -', i)
"
```

### 步骤 2：人工审（可选 — LLM 审）

```bash
# 读 copy
COPY=$(cat <output_dir>/cards/copy.md)
curl -s -X POST http://localhost:5221/api/brain/llm-service/generate \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json
prompt = '''审查以下社交文案，按品牌调性（能力下放/一人公司/AI+个人）打分 1-10 并给改进建议：

$COPY

只输出 JSON: {\\\"score\\\": int, \\\"feedback\\\": str}
'''
print(json.dumps({'tier':'thalamus','prompt':prompt,'max_tokens':500,'format':'json'}))
")" | python3 -m json.tool | head
```

### 步骤 3：决定 APPROVED / REVISION

- score ≥ 7 且无禁用词 → APPROVED
- score < 7 或命中禁用词 → REVISION，feedback 回传给下一轮 copywrite

## 裁决规则（给 LangGraph 用）

| 条件 | verdict |
|------|---------|
| 禁用词命中 OR copy.md < 200 字 OR article.md < 500 字 | REVISION |
| 所有品牌关键词都没命中 | REVISION |
| 程序化 score ≥ 6 + 无禁用词 | APPROVED |
| LLM 审查 score ≥ 7 | APPROVED（覆盖程序化） |

## 相关文件路径
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/copy_review.py`
- Brand voice: `/Users/administrator/.claude-account1/projects/-Users-administrator-perfect21-zenithjoy/memory/brand_voice.md`

## LangGraph Contract

### Input（从 ContentPipelineState 读）
- `pipeline_id`: UUID
- `keyword`: 关键词
- `output_dir`: 产物根目录
- `copy_path`: `<output_dir>/cards/copy.md`
- `article_path`: `<output_dir>/article/article.md`

### Output（写回 state）
- `copy_review_verdict`: `"APPROVED"` | `"REVISION"`
- `copy_review_feedback`: REVISION 时非空字符串（LLM 或程序化 issues 拼接），APPROVED 时 null
- `copy_review_round`: 累加计数（graph reducer 负责，节点不关心）
- `trace`: "copy_review"
- `error`: null | 错误字符串

### 条件边（content-pipeline-graph 里定义）
- `APPROVED` → 进入 `generate` 节点
- `REVISION` → 回 `copywrite` 节点重写，feedback 作为 copywrite 下一轮的输入

### 失败策略
节点本身执行失败（比如读文件失败）抛错让 graph 处理；审查判 REVISION 不是失败，是正常流转。
