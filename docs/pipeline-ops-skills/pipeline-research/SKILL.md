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

# 打包请求体（python 处理 JSON 转义）
LLM_REQ=$(python3 -c "
import json, os
print(json.dumps({'tier':'thalamus','prompt':os.environ['PROMPT'],'max_tokens':8192,'timeout':180,'format':'json'}))
")

# 用 stdin 传 body（避免 prompt 过大时 exec(3) argv too long；argv 上限 ~256KB，走 stdin 无此限制）
# 同时抓 HTTP status code，便于失败 reason 带上下文
RESP=$(printf '%s' "$LLM_REQ" | curl -s -w $'\n__HTTP_STATUS__=%{http_code}' \
  --max-time 180 \
  -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
  -H 'Content-Type: application/json' \
  --data-binary @-)
LLM_HTTP=$(printf '%s\n' "$RESP" | awk -F= '/^__HTTP_STATUS__=/{print $2}' | tail -1)
LLM_BODY=$(printf '%s\n' "$RESP" | sed '$d')

TEXT=$(printf '%s' "$LLM_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('data') or {}).get('text') or (d.get('data') or {}).get('content') or '')" 2>/dev/null)

if [ -z "$TEXT" ]; then
  LLM_ERR_BODY=$(printf '%s' "$LLM_BODY" | tr -d '\n\r' | head -c 100 | sed 's/"/\\"/g')
  echo "{\"findings_path\":null,\"output_dir\":\"${OUT_DIR}\",\"error\":\"LLM HTTP ${LLM_HTTP:-?} - ${LLM_ERR_BODY}\"}"
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

stdout 最后一行，**必需字段**（缺失 / 类型不符一律视为 skill 失败）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `findings_path` | `string \| null` | findings.json 绝对路径；LLM 失败时为 `null` |
| `output_dir` | `string` | 产物根目录绝对路径（`~/content-output/research/...`） |
| `count` | `int` | findings 数量；失败时为 `0` |
| `error` | `string` | **仅失败时出现**。格式：`"LLM HTTP <status> - <body 前 100 字>"` |

成功示例：
```json
{"findings_path":"/home/.../findings.json","output_dir":"/home/.../solo-company-case-xxx","count":10}
```

失败示例：
```json
{"findings_path":null,"output_dir":"/home/.../solo-company-case-xxx","count":0,"error":"LLM HTTP 503 - {\"error\":{\"code\":\"BRAIN_LLM_TIMEOUT\"..."}
```
