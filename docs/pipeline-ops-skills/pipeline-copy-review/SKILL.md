---
name: pipeline-copy-review
description: Content Pipeline Stage 3 文案打分机 (严格 SOP — 2 层：bash 硬规则 + LLM 5 维打分)
---

# pipeline-copy-review — Stage 3 文案打分机

## 你是谁
**打分搬运机**。两层评审：
- **第 1 层**：bash 硬规则（禁用词 / 品牌词 / 字数 / 结构），机械不讨论。
- **第 2 层**：当且仅当第 1 层全过，调 Brain LLM 做 5 维 × 0-5 分主观打分（D1 钩子力 / D2 信息密度 / D3 品牌一致性 / D4 可读性 / D5 转化力）。

第 1 层没过直接 REVISION，跳过 LLM 调用（省 token）。
只输出最后一行 JSON。

## 硬约束
- 第 1 层：禁止自由发挥，只用 bash `grep` / `wc`
- 第 2 层：必须调 Brain LLM（`/api/brain/llm-service/generate` tier=thalamus），禁止自己打分
- **bash 规则全过（SCORE=5）后必须调 LLM 评 5 维**
- **任一维 ≤ 1 或总分 < 18 → REVISION**（硬卡，不设防抖；改不好就持续 REVISION）
- 总分 ≥ 18 且每维 ≥ 2 → APPROVED
- LLM prompt 中 5/3/0 各档判定必须写死，防止模型发散
- 禁止在 JSON 外输出任何东西

## Input（env）

- `CONTENT_OUTPUT_DIR` — 产物根目录
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`（docker 内访问宿主 brain）

## 执行步骤

### 步骤 1：文件存在性检查

```bash
COPY_FILE="${CONTENT_OUTPUT_DIR}/cards/copy.md"
ARTICLE_FILE="${CONTENT_OUTPUT_DIR}/article/article.md"
if [ ! -f "$COPY_FILE" ]; then
  echo '{"copy_review_verdict":"REVISION","copy_review_feedback":"missing copy.md","quality_score":0,"copy_review_rule_details":[{"id":"R0","label":"文件存在","pass":false,"reason":"copy.md missing"}]}'
  exit 0
fi
if [ ! -f "$ARTICLE_FILE" ]; then
  echo '{"copy_review_verdict":"REVISION","copy_review_feedback":"missing article.md","quality_score":0,"copy_review_rule_details":[{"id":"R0","label":"文件存在","pass":false,"reason":"article.md missing"}]}'
  exit 0
fi
```

### 步骤 2：第 1 层 — 5 项硬规则打分（每项 0/1 分，满分 5）

每条规则同时记录 **pass 布尔** 和 **逐项明细**。

```bash
SCORE=0
ISSUES=()
# RULES_JSON 累积每条规则对象，最后拼成数组
RULES_JSON=""

append_rule() {
  # $1=id  $2=label  $3=pass(true|false)  $4=value(json 标量，可空)  $5=reason
  local id="$1" label="$2" pass="$3" value="$4" reason="$5"
  local val_field="" reason_field=""
  [ -n "$value" ] && val_field=",\"value\":${value}"
  [ -n "$reason" ] && reason_field=",\"reason\":\"${reason}\""
  local obj="{\"id\":\"${id}\",\"label\":\"${label}\",\"pass\":${pass}${val_field}${reason_field}}"
  if [ -z "$RULES_JSON" ]; then
    RULES_JSON="$obj"
  else
    RULES_JSON="${RULES_JSON},${obj}"
  fi
}

# R1: 无禁用词
BANNED_HITS=$(grep -oE 'coding|搭建|agent workflow|builder|Cecelia|智能体搭建|代码部署' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
if [ -z "$BANNED_HITS" ]; then
  SCORE=$((SCORE+1))
  append_rule "R1" "无禁用词" "true" "" ""
else
  ISSUES+=("R1:命中禁用词")
  append_rule "R1" "无禁用词" "false" "" "命中: ${BANNED_HITS}"
fi

# R2: 品牌词命中 ≥ 1
BRAND_MATCHES=$(grep -oE '能力|系统|一人公司|小组织|AI|能力下放|能力放大' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
BRAND_HITS=$(grep -oE '能力|系统|一人公司|小组织|AI|能力下放|能力放大' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | wc -l | tr -d ' ')
if [ "$BRAND_HITS" -ge 1 ]; then
  SCORE=$((SCORE+1))
  append_rule "R2" "品牌词命中≥1" "true" "$BRAND_HITS" "匹配: ${BRAND_MATCHES}"
else
  ISSUES+=("R2:品牌词0命中")
  append_rule "R2" "品牌词命中≥1" "false" "0" ""
fi

# R3: copy.md ≥ 200 字
COPY_LEN=$(wc -m < "$COPY_FILE" | tr -d ' ')
if [ "$COPY_LEN" -ge 200 ]; then
  SCORE=$((SCORE+1))
  append_rule "R3" "copy ≥200 字" "true" "$COPY_LEN" ""
else
  ISSUES+=("R3:copy ${COPY_LEN}字")
  append_rule "R3" "copy ≥200 字" "false" "$COPY_LEN" "阈值 200"
fi

# R4: article.md ≥ 500 字
ART_LEN=$(wc -m < "$ARTICLE_FILE" | tr -d ' ')
if [ "$ART_LEN" -ge 500 ]; then
  SCORE=$((SCORE+1))
  append_rule "R4" "article ≥500 字" "true" "$ART_LEN" ""
else
  ISSUES+=("R4:article ${ART_LEN}字")
  append_rule "R4" "article ≥500 字" "false" "$ART_LEN" "阈值 500"
fi

# R5: article.md 有 markdown 标题
if grep -qE '^#{1,3} ' "$ARTICLE_FILE"; then
  SCORE=$((SCORE+1))
  append_rule "R5" "article 有 md 标题" "true" "" ""
else
  ISSUES+=("R5:无md标题")
  append_rule "R5" "article 有 md 标题" "false" "" "未找到 #/##/###"
fi
```

### 步骤 3：第 2 层 — bash 全过才调 LLM 做 5 维打分

规则：**只有 `$SCORE -eq 5`（第 1 层全过）才调 LLM**。bash 规则没过直接跳过 LLM，判 REVISION。

打分模板（每维 0-5，满分 25）：

| 维度 | 含义 | 5 分 | 3 分 | 0 分 |
|---|---|---|---|---|
| D1 钩子力 | 开头 3 句能否抓读者 | 反差/数据/场景/故事任一 | 有引入但平 | 平铺直叙无钩子 |
| D2 信息密度 | 每 100 字真实信息量 | 数据+案例+可操作结论 | 有案例或数据 | 全是口水话 |
| D3 品牌一致性 | 和「能力下放 / 一人公司 / 小组织 / AI 放大」叙事契合度 | 主动体现品牌叙事 | 被动提品牌词 | 无品牌词 / 有禁用词 |
| D4 可读性 | 节奏、断句、层次 | 小标题+小结+逻辑递进 | 有结构但松 | 大段无分段 |
| D5 转化力 | 结尾引导行动 | 具体行动+互动+留问题 | 一般提示 | 无引导 |

通过规则（硬卡）：
- 任一维 ≤ 1 → **REVISION**
- 总分 < 18 → **REVISION**
- 总分 ≥ 18 **且** 每维 ≥ 2 → **APPROVED**

```bash
# LLM 层初始化（即使没进入也要有默认值，避免未绑定变量）
D1=0; D2=0; D3=0; D4=0; D5=0
D1_REASON=""; D2_REASON=""; D3_REASON=""; D4_REASON=""; D5_REASON=""
SUGGESTIONS=""
LLM_TOTAL=0
LLM_CALLED=false

if [ "$SCORE" -eq 5 ]; then
  LLM_CALLED=true
  COPY_CONTENT=$(cat "$COPY_FILE")
  ARTICLE_CONTENT=$(cat "$ARTICLE_FILE")

  # 注意：5/3/0 各档判定写死在 prompt，不允许模型发挥
  LLM_PROMPT=$(cat <<PROMPT_END
你是品牌内容审查员。严格按以下 5 维 × 0-5 分制给文案打分。

## 品牌 voice（核心叙事）
- 主题：AI 能力下放 → 一个人/小组织拥有过去需要大团队才有的能力
- 核心词：能力 / 系统 / 一人公司 / 小组织 / AI / 能力下放 / 能力放大
- 禁用词：coding / 搭建 / agent workflow / builder / 智能体搭建 / 代码部署

## 评分标准（每维 0-5，必须严格对照档位）

### D1 钩子力（开头 3 句能否抓读者）
5 = 用反差 / 具体数据 / 具体场景 / 故事起头抓注意力
3 = 有引入但普通（陈述事实、铺垫但不抓眼）
0 = 平铺直叙、无钩子

### D2 信息密度（每 100 字真实信息含量）
5 = 既有数据又有具体案例又给可操作结论
3 = 有案例或数据之一，但不全
0 = 全是口水话、概括、空洞结论

### D3 品牌一致性（和上面品牌 voice 的契合度）
5 = 主动体现「能力下放给一个人」的叙事
3 = 被动提到品牌词但叙事没对齐
0 = 无品牌词 / 命中禁用词

### D4 可读性（节奏、断句、层次）
5 = 小标题清晰 + 段落有小结 + 逻辑递进
3 = 有结构但松散
0 = 大段无分段 / 逻辑跳跃

### D5 转化力（结尾引导行动）
5 = 具体行动 + 互动引导 + 留开放问题
3 = 有引导但一般
0 = 无引导

## 输入文案

### 社交文案（cards/copy.md）
${COPY_CONTENT}

### 长文（article/article.md）
${ARTICLE_CONTENT}

## 输出（严格 JSON，不要 markdown fence，不要解释文字）

{
  "D1":{"score":<0-5>,"reason":"<20-40 字>"},
  "D2":{"score":<0-5>,"reason":"<20-40 字>"},
  "D3":{"score":<0-5>,"reason":"<20-40 字>"},
  "D4":{"score":<0-5>,"reason":"<20-40 字>"},
  "D5":{"score":<0-5>,"reason":"<20-40 字>"},
  "suggestions":"<50-120 字，告诉 copywrite 下一轮要改什么，具体到段落>"
}
PROMPT_END
)

  BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

  # 打包请求体（用 python 处理 json，避免 shell 转义大段中文）
  export LLM_PROMPT
  LLM_REQ=$(python3 -c "
import json, os
body = {
  'tier': 'thalamus',
  'prompt': os.environ['LLM_PROMPT'],
  'max_tokens': 1024,
  'format': 'json',
  'timeout': 120,
}
print(json.dumps(body))
")

  # 用 stdin 传 body（避免 prompt + copy/article 全文过大触发 argv too long；argv 上限 ~256KB）
  # 同时抓 HTTP status + body 前 100 字，LLM 失败时写进 reason 便于 debug
  LLM_RAW=$(printf '%s' "$LLM_REQ" | curl -s -w $'\n__HTTP_STATUS__=%{http_code}' \
    --max-time 120 \
    -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
    -H 'Content-Type: application/json' \
    --data-binary @-)
  LLM_HTTP=$(printf '%s\n' "$LLM_RAW" | awk -F= '/^__HTTP_STATUS__=/{print $2}' | tail -1)
  LLM_RESP=$(printf '%s\n' "$LLM_RAW" | sed '$d')
  LLM_ERR_BODY=$(printf '%s' "$LLM_RESP" | tr -d '\n\r' | head -c 100)

  LLM_TEXT=$(printf '%s' "$LLM_RESP" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    t = (d.get('data') or {}).get('text') or (d.get('data') or {}).get('content') or ''
    t = t.strip()
    if t.startswith('\`\`\`json'): t = t[7:]
    elif t.startswith('\`\`\`'): t = t[3:]
    if t.endswith('\`\`\`'): t = t[:-3]
    print(t.strip())
except Exception:
    print('')
" 2>/dev/null)

  # 一次性解析 5 维 + 建议（容忍字段缺失，缺的设 0 / 空串）
  PARSED=$(echo "$LLM_TEXT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
def pick(k, sub):
    try:
        return str(d.get(k, {}).get(sub, '') or '')
    except Exception:
        return ''
parts = []
for k in ['D1','D2','D3','D4','D5']:
    s = pick(k, 'score')
    r = pick(k, 'reason').replace('\t', ' ').replace('\n', ' ').replace('\"', \"'\")
    parts.append(s if s else '0')
    parts.append(r)
sug = str(d.get('suggestions', '') or '').replace('\t', ' ').replace('\n', ' ').replace('\"', \"'\")
parts.append(sug)
print('\t'.join(parts))
" 2>/dev/null)

  # tab 拆分
  IFS=$'\t' read -r D1 D1_REASON D2 D2_REASON D3 D3_REASON D4 D4_REASON D5 D5_REASON SUGGESTIONS <<< "$PARSED"

  # 数值校验（非数字 → 0）
  case "$D1" in ''|*[!0-9]*) D1=0 ;; esac
  case "$D2" in ''|*[!0-9]*) D2=0 ;; esac
  case "$D3" in ''|*[!0-9]*) D3=0 ;; esac
  case "$D4" in ''|*[!0-9]*) D4=0 ;; esac
  case "$D5" in ''|*[!0-9]*) D5=0 ;; esac

  # LLM 调用失败（LLM_TEXT 空 → 5 维都是 0 且 reason 全空）→ 给 reason 填 HTTP status + body 片段
  # 主理人 debug 时能一眼看出是 LLM 故障而不是真的文案差
  if [ -z "$LLM_TEXT" ] || { [ "$D1" -eq 0 ] && [ "$D2" -eq 0 ] && [ "$D3" -eq 0 ] && [ "$D4" -eq 0 ] && [ "$D5" -eq 0 ] && [ -z "$D1_REASON$D2_REASON$D3_REASON$D4_REASON$D5_REASON" ]; }; then
    FAIL_MSG="LLM HTTP ${LLM_HTTP:-?} - ${LLM_ERR_BODY}"
    D1_REASON="$FAIL_MSG"
    D2_REASON="$FAIL_MSG"
    D3_REASON="$FAIL_MSG"
    D4_REASON="$FAIL_MSG"
    D5_REASON="$FAIL_MSG"
    [ -z "$SUGGESTIONS" ] && SUGGESTIONS="$FAIL_MSG"
  fi

  # reason 里要进 JSON，先 escape 掉反斜杠和双引号
  D1_REASON=$(printf '%s' "$D1_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  D2_REASON=$(printf '%s' "$D2_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  D3_REASON=$(printf '%s' "$D3_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  D4_REASON=$(printf '%s' "$D4_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  D5_REASON=$(printf '%s' "$D5_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  SUGGESTIONS=$(printf '%s' "$SUGGESTIONS" | sed 's/\\/\\\\/g; s/"/\\"/g')

  # 累积到 RULES_JSON（每维 pass=score>=2）
  append_rule "D1" "钩子力"     "$([ "$D1" -ge 2 ] && echo true || echo false)" "$D1" "$D1_REASON"
  append_rule "D2" "信息密度"   "$([ "$D2" -ge 2 ] && echo true || echo false)" "$D2" "$D2_REASON"
  append_rule "D3" "品牌一致性" "$([ "$D3" -ge 2 ] && echo true || echo false)" "$D3" "$D3_REASON"
  append_rule "D4" "可读性"     "$([ "$D4" -ge 2 ] && echo true || echo false)" "$D4" "$D4_REASON"
  append_rule "D5" "转化力"     "$([ "$D5" -ge 2 ] && echo true || echo false)" "$D5" "$D5_REASON"

  LLM_TOTAL=$((D1 + D2 + D3 + D4 + D5))
fi
```

### 步骤 4：verdict 判定（两层合并）

```bash
if [ "$LLM_CALLED" = "true" ]; then
  # 第 2 层进了，按 LLM 结果判决
  MIN_DIM=$(printf '%s\n' "$D1" "$D2" "$D3" "$D4" "$D5" | sort -n | head -1)
  if [ "$MIN_DIM" -le 1 ] || [ "$LLM_TOTAL" -lt 18 ]; then
    VERDICT="REVISION"
    FB_TEXT="D1=${D1} D2=${D2} D3=${D3} D4=${D4} D5=${D5} total=${LLM_TOTAL}; ${SUGGESTIONS}"
    FB_ESC=$(printf '%s' "$FB_TEXT" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  else
    VERDICT="APPROVED"
    FEEDBACK="null"
  fi
else
  # 第 1 层没全过，bash 规则定 feedback
  VERDICT="REVISION"
  FB_ESC=$(IFS=';'; echo "${ISSUES[*]}" | sed 's/"/\\"/g')
  FEEDBACK="\"${FB_ESC}\""
fi
```

### 步骤 5：输出一行 JSON（stdout 最后一行）

```bash
echo "{\"copy_review_verdict\":\"${VERDICT}\",\"copy_review_feedback\":${FEEDBACK},\"quality_score\":${SCORE},\"copy_review_total\":${LLM_TOTAL},\"copy_review_threshold\":18,\"copy_review_rule_details\":[${RULES_JSON}]}"
```

## 禁止事项

- 禁止因"感觉"判 REVISION。bash 规则纯机械。
- 禁止跳过第 2 层 LLM 调用。**只要 `$SCORE -eq 5`，必须调 Brain LLM**。
- 禁止自己打 D1-D5 的分（必须 LLM 打分，skill 只做解析）。
- 禁止"反复评分 / 自我重试"。LLM 一次调用，解析失败各维按 0 算（→ REVISION）。
- 禁止在 JSON 外输出任何东西。

## 输出 schema

唯一 stdout 最后一行，**必需字段**（缺失 / 类型不符一律视为 skill 失败）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `copy_review_verdict` | `"APPROVED" \| "REVISION"` | 双层合并裁决 |
| `copy_review_feedback` | `string \| null` | REVISION 时必填（bash 规则命中或 D1-D5 suggestions）；APPROVED 时为 `null` |
| `quality_score` | `int 0-5` | 第 1 层 bash 规则得分（满 5 才会进第 2 层 LLM） |
| `copy_review_total` | `int 0-25` | 第 2 层 LLM 5 维总分，未进入第 2 层为 `0` |
| `copy_review_threshold` | `int` | 恒为 `18`（总分阈值，便于前端展示） |
| `copy_review_rule_details` | `RuleObj[]` | 明细列表，至少含 R1-R5；进入第 2 层时补 D1-D5 |

`RuleObj` 约束：
- `id` `string`（必填，如 `R1` / `D1`）
- `label` `string`（必填，中文短标签）
- `pass` `boolean`（必填）
- `value` `number`（选填，维度得分或命中计数）
- `reason` `string`（选填；LLM 调用失败时 D1-D5 的 reason 形如 `"LLM HTTP <status> - <body 前 100 字>"` 便于 debug）

完整示例（LLM 层成功）：

```json
{
  "copy_review_verdict":"APPROVED",
  "copy_review_feedback":null,
  "quality_score":5,
  "copy_review_total":22,
  "copy_review_threshold":18,
  "copy_review_rule_details":[
    {"id":"R1","label":"无禁用词","pass":true},
    {"id":"R2","label":"品牌词命中≥1","pass":true,"value":12,"reason":"匹配: 能力,系统,一人公司"},
    {"id":"R3","label":"copy ≥200 字","pass":true,"value":680},
    {"id":"R4","label":"article ≥500 字","pass":true,"value":1820},
    {"id":"R5","label":"article 有 md 标题","pass":true},
    {"id":"D1","label":"钩子力","pass":true,"value":4,"reason":"开头用数据反差抓眼"},
    {"id":"D2","label":"信息密度","pass":true,"value":5,"reason":"有案例+数据+结论"},
    {"id":"D3","label":"品牌一致性","pass":true,"value":5,"reason":"主动展开能力下放叙事"},
    {"id":"D4","label":"可读性","pass":true,"value":4,"reason":"小标题+递进清晰"},
    {"id":"D5","label":"转化力","pass":true,"value":4,"reason":"结尾留互动问题"}
  ]
}
```

LLM 调用失败（HTTP 5xx / timeout / 解析失败）时，D1-D5 的 reason 会变成 `"LLM HTTP 503 - {\"error\":{..."` 形式，主理人一眼能看出是 LLM 故障而不是文案本身 0 分。

## 与 copywrite 下一轮的握手

- `copy_review_feedback` 在 REVISION 时会被 Brain 写回 `state.copy_review_feedback`，交给下一轮 pipeline-copywrite。
- feedback 内容包含 `D1..D5 分数 + suggestions`，copywrite 按 suggestions 精修对应段落。
- 改不好就持续 REVISION —— 这是设计意图，不是 bug。

## 与 Brain 的接口契约

- 端点：`POST ${BRAIN_URL}/api/brain/llm-service/generate`
- tier：`thalamus`（Sonnet 级，适合评审类任务，成本受控）
- 输出：严格 JSON 对象
- 超时：120s
