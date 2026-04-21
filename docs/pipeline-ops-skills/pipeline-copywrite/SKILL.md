---
name: pipeline-copywrite
description: Content Pipeline Stage 2 文案生成机 (严格 SOP，调 Brain LLM)
---

# pipeline-copywrite — Stage 2 文案生成机

## 你是谁
**文案生成搬运机**。读 findings.json + 调 Brain LLM API + 写两个 .md 文件 + 输出 JSON。
不做主观判断，不解释，不优化，按 prompt 模板直接调 LLM。

## 硬约束
- 禁止自己写文案（用 LLM API 生成）
- 禁止对 findings 做"精选"（LLM 自己选）
- 只输出最后一行 JSON

## Input（env）

- `CONTENT_OUTPUT_DIR` — 产物根目录（如 /home/cecelia/content-output/research/solo-company-case-xxx-2026-04-20/）
- 找 findings.json: `${CONTENT_OUTPUT_DIR}/findings.json`

## 执行步骤（严格按顺序）

### 步骤 1：确认 findings.json 存在 + 建输出目录

```bash
FINDINGS="${CONTENT_OUTPUT_DIR}/findings.json"
if [ ! -f "$FINDINGS" ]; then
  echo "{\"copy_path\":null,\"article_path\":null,\"error\":\"missing findings.json at $FINDINGS\"}"
  exit 0
fi

COPY_DIR="${CONTENT_OUTPUT_DIR}/cards"
ARTICLE_DIR="${CONTENT_OUTPUT_DIR}/article"
mkdir -p "$COPY_DIR" "$ARTICLE_DIR"
COPY_FILE="$COPY_DIR/copy.md"
ARTICLE_FILE="$ARTICLE_DIR/article.md"
```

### 步骤 2：读 findings 前 7 条做 prompt 材料

```bash
FINDINGS_TEXT=$(python3 -c "
import json
d = json.load(open('$FINDINGS'))
fs = d.get('findings', [])[:7]
for i, f in enumerate(fs):
    print(f'{i+1}. {f.get(\"title\",\"\")}: {(f.get(\"content\") or \"\")[:500]}')
" 2>/dev/null)

if [ -z "$FINDINGS_TEXT" ]; then
  # python3 不在时 fallback 到 jq
  FINDINGS_TEXT=$(jq -r '.findings[:7] | to_entries[] | "\(.key+1). \(.value.title): \(.value.content[:500])"' "$FINDINGS")
fi
KEYWORD=$(jq -r '.keyword' "$FINDINGS")
```

### 步骤 3：调 Brain LLM 生成社交文案 + 长文（同一次调用，双输出）

docker 内访问宿主 brain 要用 `host.docker.internal:5221`。

```bash
PROMPT_BODY=$(cat <<PROMPT_END
你是一位专业内容创作者，把下面调研素材变成两篇内容：

1. **社交文案**（小红书/抖音风格 500-800 字，口语化，有钩子，含互动引导）
2. **公众号长文**（深度分析 1500-2000 字，结构清晰有小标题）

## 关键词
${KEYWORD}

## 调研素材
${FINDINGS_TEXT}

## 品牌要求（硬性）
- 必须出现以下品牌词至少 1 个：能力 / 系统 / 一人公司 / 小组织 / AI / 能力下放 / 能力放大
- 禁止出现：coding / 搭建 / agent workflow / builder / Cecelia / 智能体搭建 / 代码部署
- 长文必须有 markdown 标题（用 # 或 ##）

## 输出格式（严格）
=== 社交文案 ===
[500-800字内容]
=== 公众号长文 ===
[# 标题
1500-2000字内容]

禁止：问用户、说"需要更多信息"、输出选项、只写一篇。
PROMPT_END
)

# 把 prompt 打包成 JSON
LLM_REQ=$(python3 -c "
import json, os
body = {
  'tier': 'thalamus',
  'prompt': os.environ['PROMPT_BODY'],
  'max_tokens': 8192,
  'timeout': 180,
}
print(json.dumps(body))
" 2>/dev/null || echo "{\"tier\":\"thalamus\",\"prompt\":$(jq -Rs . <<<"$PROMPT_BODY"),\"max_tokens\":8192,\"timeout\":180}")

# 注入环境（docker 内走 host.docker.internal）
BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

# 用 stdin 传 body（避免 prompt + findings 过大触发 argv too long；argv 上限 ~256KB）
# 同时抓 HTTP status 便于失败 reason 带上下文
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
  echo "{\"copy_path\":null,\"article_path\":null,\"error\":\"LLM HTTP ${LLM_HTTP:-?} - ${LLM_ERR_BODY}\"}"
  exit 0
fi
```

### 步骤 4：切分两段 + 写文件

```bash
# 用 awk 切分 === 社交文案 === 和 === 公众号长文 ===
echo "$TEXT" | awk '
  /=== 社交文案 ===/ { mode="copy"; next }
  /=== 公众号长文 ===/ { mode="article"; next }
  mode=="copy" { print > "'"$COPY_FILE"'" }
  mode=="article" { print > "'"$ARTICLE_FILE"'" }
'

# 兜底：如果切分失败（没找到分隔符），整段写到 copy.md，article.md 复制 copy
if [ ! -s "$COPY_FILE" ]; then
  echo "$TEXT" > "$COPY_FILE"
fi
if [ ! -s "$ARTICLE_FILE" ]; then
  cp "$COPY_FILE" "$ARTICLE_FILE"
fi
```

### 步骤 5：输出一行 JSON（stdout 最后一行）

```bash
echo "{\"copy_path\":\"$COPY_FILE\",\"article_path\":\"$ARTICLE_FILE\",\"copy_len\":$(wc -m < $COPY_FILE),\"article_len\":$(wc -m < $ARTICLE_FILE)}"
```

## 禁止事项

- 禁止"我觉得应该"自己写文案
- 禁止调 `localhost:5221`（docker 里访问不到宿主 — 用 `host.docker.internal:5221`）
- 禁止跳过调 LLM（脚本必须真调 Brain API）
- 禁止在 JSON 外输出说明

## 输出 schema

stdout 最后一行，**必需字段**（缺失 / 类型不符一律视为 skill 失败）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `copy_path` | `string \| null` | 社交文案 cards/copy.md 绝对路径；LLM 失败时 `null` |
| `article_path` | `string \| null` | 长文 article/article.md 绝对路径；LLM 失败时 `null` |
| `copy_len` | `int` | copy.md 字符数（`wc -m`）；失败时字段可缺省 |
| `article_len` | `int` | article.md 字符数；失败时字段可缺省 |
| `error` | `string` | **仅失败时出现**。格式：`"LLM HTTP <status> - <body 前 100 字>"` |

成功示例：
```json
{"copy_path":"/home/.../cards/copy.md","article_path":"/home/.../article/article.md","copy_len":680,"article_len":1820}
```

失败示例：
```json
{"copy_path":null,"article_path":null,"error":"LLM HTTP 401 - {\"error\":{\"code\":\"AUTH_ERROR\"..."}
```
