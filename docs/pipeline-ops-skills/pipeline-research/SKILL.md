---
name: pipeline-research
description: Content Pipeline Stage 1 调研机 (严格 SOP，调 Brain LLM 生成 findings)
---

# pipeline-research — Stage 1 调研机

## 你是谁
**调研搬运机**。调 Brain LLM 生成结构化 findings.json + 输出一行 JSON。
不调 NotebookLM CLI（docker 内无 notebooklm CLI）。直接用业务 LLM 根据 keyword 生成结构化调研素材。

## 硬约束
- 禁止生成小于 8 条 findings
- 禁止输出纯粹模板内容（每条必须有 title + content ≥ 100 字）
- 只用 `curl` + `python3` 处理 JSON
- 只输出最后一行 JSON

## Input（env）

- `CONTENT_PIPELINE_KEYWORD` 或通过 prompt 自带的 keyword
- 输出目录按 `~/content-output/research/solo-company-case-<slug(keyword)>-<YYYY-MM-DD>/findings.json`

## 执行步骤

### 步骤 1：准备输出目录 + slug

```bash
KEYWORD="${CONTENT_PIPELINE_KEYWORD:-$1}"
SLUG=$(echo "$KEYWORD" | python3 -c "
import sys, re
t = sys.stdin.read().strip()
t = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff-]', '-', t)
t = re.sub(r'-+', '-', t)[:40]
print(t)
")
TODAY=$(date +%Y-%m-%d)
OUT_DIR="/home/cecelia/content-output/research/solo-company-case-${SLUG}-${TODAY}"
mkdir -p "$OUT_DIR"
FINDINGS="$OUT_DIR/findings.json"
```

### 步骤 2：调 Brain LLM 生成结构化 findings

```bash
PROMPT=$(cat <<PROMPT_END
你是内容研究员。为关键词「${KEYWORD}」生成 10 条结构化调研素材。

要求：
1. 每条 title ≤ 40 字，content 100-400 字
2. 围绕"超级个体 / 一人公司 / AI 能力下放"的场景
3. 提供具体数据点、案例、工具名（即使是示例）
4. 不得输出"待补充"/"暂无"/占位符

只输出严格 JSON，不要 markdown fence，不要解释：

{
  "keyword": "${KEYWORD}",
  "series": "solo-company-case",
  "total_findings": 10,
  "findings": [
    {"id":"f001","title":"...","content":"...","source":"LLM","brand_relevance":4,"used_in":[]},
    ... 10 条
  ]
}
PROMPT_END
)

BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json, os
print(json.dumps({'tier':'thalamus','prompt':os.environ['PROMPT'],'max_tokens':8192,'timeout':180,'format':'json'}))
")")

TEXT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('data') or {}).get('text') or (d.get('data') or {}).get('content') or '')" 2>/dev/null)

if [ -z "$TEXT" ]; then
  echo "{\"findings_path\":null,\"output_dir\":\"${OUT_DIR}\",\"error\":\"LLM 返回空\"}"
  exit 0
fi

# 去 markdown fence
TEXT=$(echo "$TEXT" | sed 's/^```json//' | sed 's/^```//' | sed 's/```$//')
echo "$TEXT" > "$FINDINGS"
```

### 步骤 3：输出一行 JSON

```bash
COUNT=$(python3 -c "import json; print(len(json.load(open('$FINDINGS')).get('findings', [])))" 2>/dev/null || echo 0)
echo "{\"findings_path\":\"${FINDINGS}\",\"output_dir\":\"${OUT_DIR}\",\"count\":${COUNT}}"
```

## 禁止事项

- 禁止调 notebooklm CLI（docker 内没装）
- 禁止自己写内容（必须调 LLM）
- 禁止使用占位符（待补充/暂无数据）
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{"findings_path":"...","output_dir":"...","count":10}
```
