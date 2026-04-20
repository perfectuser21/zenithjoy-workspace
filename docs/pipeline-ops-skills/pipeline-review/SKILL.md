---
name: pipeline-review
description: Content Pipeline Stage 5 图片检查 (严格 SOP — 2 层：bash 完整性 + 4 维 vision 评审)
---

# pipeline-review — Stage 5 图片评审机

## 你是谁
**图片评审搬运机**。两层检查：
- **第 1 层**：bash 完整性（PNG 数量 ≥ 8 + 每张 ≥ 10KB）。
- **第 2 层**：每张图调 Brain vision 做 4 维打分（V1 文字渲染 / V2 数据一致 / V3 布局 / V4 美感）。

第 1 层没过直接 FAIL，跳过 vision 调用。
只输出最后一行 JSON。

## 硬约束
- 第 1 层：只用 `ls` / `wc` / `stat` / `du`
- 第 2 层：必须调 Brain vision 端点；**端点未上线时按 TODO 跳过但保留 schema 占位**（见步骤 3 说明）
- **任一张 V1 ≤ 1 或 V3 ≤ 1 → 全局 FAIL**（空字 / 严重裁切一票否决）
- 所有张均分 ≥ 14（4 维 × 0-5 满分 20 的 70%）→ PASS
- 否则 REVISION / FAIL → 触发下一轮 generate 重新渲染
- vision prompt 中 5/3/0 各档判定必须写死，防止模型发散
- 禁止在 JSON 外输出任何东西

## Input（env）

- `CONTENT_OUTPUT_DIR` — 产物根目录
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`
- `BRAIN_VISION_ENABLED` — 可选，默认 `true`（Brain 已暴露 `/api/brain/llm-service/vision` 端点，见 cecelia PR #2473）。如需临时关闭（例如账号超配额紧急回退），设置 `false` 即可降级到占位模式。

## 执行步骤

### 步骤 1：cards 目录存在

```bash
CARDS_DIR="${CONTENT_OUTPUT_DIR}/cards"
if [ ! -d "$CARDS_DIR" ]; then
  echo '{"image_review_verdict":"FAIL","image_review_feedback":"missing cards/ dir","card_count":0,"image_review_rule_details":[]}'
  exit 0
fi
```

### 步骤 2：第 1 层 — 每张 PNG 的体积 + 判定

```bash
PER_IMAGE_JSON=""
PNG_COUNT=0
SMALL_COUNT=0
# 记录通过第 1 层的图路径，供第 2 层 vision 使用
PASSED_IMGS=()

for f in "$CARDS_DIR"/*.png; do
  [ -f "$f" ] || continue
  PNG_COUNT=$((PNG_COUNT+1))
  NAME=$(basename "$f")
  SIZE=$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f" 2>/dev/null)
  if [ "$SIZE" -lt 10000 ]; then
    PASS="false"
    REASON=",\"reason\":\"size ${SIZE}B < 10KB\""
    SMALL_COUNT=$((SMALL_COUNT+1))
  else
    PASS="true"
    REASON=""
    PASSED_IMGS+=("$f")
  fi
  OBJ="{\"id\":\"${NAME}\",\"label\":\"${NAME}\",\"pass\":${PASS},\"value\":${SIZE}${REASON}}"
  if [ -z "$PER_IMAGE_JSON" ]; then
    PER_IMAGE_JSON="$OBJ"
  else
    PER_IMAGE_JSON="${PER_IMAGE_JSON},${OBJ}"
  fi
done
```

### 步骤 3：第 2 层 — 4 维 vision 打分（bash 全过才进）

打分模板（每张 4 维 × 0-5 = 20 分/张）：

| 维度 | 含义 | 5 分 | 3 分 | 0 分 |
|---|---|---|---|---|
| V1 文字渲染 | 图上中文完整清晰 | 所有字清晰 | 大部分显示 | 空字 / 乱码 |
| V2 数据一致 | 图上文字匹配 person-data.json | 精确对应 | 大致对应 | 完全不对 |
| V3 布局 | 文字不裁切/不堆叠 | 完美 | 小问题 | 严重裁切/堆叠 |
| V4 美感 | 颜色/间距/层次 | 精致 | 合格 | 乱/丑 |

通过规则（硬卡）：
- 任一张 **V1 ≤ 1**（空字）→ 全局 **FAIL**
- 任一张 **V3 ≤ 1**（严重裁切）→ 全局 **FAIL**
- 所有张均分 ≥ 14（70%）→ **PASS**
- 否则 **REVISION** → generate 下一轮重新渲染

**严格执行**：本步骤必须**原样 copy-paste 整段 bash 跑**。禁止你（Claude）阅读 curl 返回后"觉得账号没额度就跳过循环"——必须让每张图都进 curl，失败的 graceful degrade 由 bash 自己处理。输出字段 `vision_enabled` / `vision_failed_count` 必须**严格由下面 bash 逻辑产生**，你不得改写数值。

```bash
# 初始化 vision 相关变量
VISION_RULES_JSON=""
FAIL_ANY_V1=false
FAIL_ANY_V3=false
SUM_TOTAL=0
NUM_IMGS=0           # 成功完成 vision 打分的图片数（失败不计入）
VISION_FAIL_COUNT=0  # vision 调用失败（endpoint 报错或解析不出 score）的图片数
AVG=0
VISION_CALLED=false

# 判定第 1 层是否全过
BASH_OK=true
[ "$PNG_COUNT" -lt 8 ] && BASH_OK=false
[ "$SMALL_COUNT" -gt 0 ] && BASH_OK=false

# Brain 已暴露 POST /api/brain/llm-service/vision（cecelia PR #2473 已合）。
# 默认启用第 2 层 vision 评审。需要临时关闭时设 BRAIN_VISION_ENABLED=false
# 即可降级到占位模式（per-image 填 0 + reason="vision endpoint disabled"）。
VISION_ENABLED="${BRAIN_VISION_ENABLED:-true}"

if [ "$BASH_OK" = "true" ] && [ "$VISION_ENABLED" = "true" ]; then
  VISION_CALLED=true
  BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"
  PERSON_DATA_FILE="${CONTENT_OUTPUT_DIR}/person-data.json"
  PERSON_DATA_TEXT=$(cat "$PERSON_DATA_FILE" 2>/dev/null || echo "{}")

  for img in "${PASSED_IMGS[@]}"; do
    NAME=$(basename "$img")
    IMG_B64=$(base64 < "$img" | tr -d '\n')

    VISION_PROMPT=$(cat <<PROMPT_END
你是图片质量审查员。严格按 4 维 × 0-5 分制评估这张图。

## person-data.json（图上文字应该对应这些数据）
${PERSON_DATA_TEXT}

## 评分标准（每维 0-5，必须严格对照档位）

### V1 文字渲染（图上中文是否完整清晰）
5 = 所有字清晰可读
3 = 大部分字显示
0 = 空字 / 乱码 / 缺字

### V2 数据一致（图上文字是否对得上 person-data）
5 = 精确对应（name/quote/stats 等）
3 = 大致对应
0 = 完全不对 / 张冠李戴

### V3 布局（文字不裁切、不堆叠）
5 = 完美
3 = 有小问题
0 = 严重裁切 / 堆叠

### V4 视觉美感（颜色/间距/层次）
5 = 精致
3 = 合格
0 = 乱 / 丑

## 输出（严格 JSON，不要 markdown fence，不要解释）

{"V1":{"score":<0-5>,"reason":"<20-40 字>"},"V2":{"score":<0-5>,"reason":"..."},"V3":{"score":<0-5>,"reason":"..."},"V4":{"score":<0-5>,"reason":"..."}}
PROMPT_END
)

    export VISION_PROMPT IMG_B64
    V_REQ=$(python3 -c "
import json, os
body = {
  'tier': 'thalamus',
  'prompt': os.environ['VISION_PROMPT'],
  'image_base64': os.environ['IMG_B64'],
  'image_mime': 'image/png',
  'max_tokens': 512,
  'format': 'json',
  'timeout': 60,
}
print(json.dumps(body))
")

    # 同时抓 HTTP status code 和 body，便于 graceful degrade
    VRESP=$(curl -s -w $'\n__HTTP_STATUS__=%{http_code}' \
      --max-time 90 \
      -X POST "$BRAIN_URL/api/brain/llm-service/vision" \
      -H 'Content-Type: application/json' \
      -d "$V_REQ")
    VHTTP=$(printf '%s\n' "$VRESP" | awk -F= '/^__HTTP_STATUS__=/{print $2}' | tail -1)
    VBODY=$(printf '%s\n' "$VRESP" | sed '$d')

    # 用 python 统一判断：是 success 还是 error，提取 text 或 error message
    export VBODY VHTTP
    VMETA=$(python3 -c "
import json, os
body = os.environ.get('VBODY', '').strip()
http = os.environ.get('VHTTP', '').strip() or '0'
ok = 'false'
text = ''
err = ''
try:
    d = json.loads(body) if body else {}
except Exception:
    d = {}
    err = 'vision response not json (http ' + http + ')'
if not err:
    success = d.get('success')
    if http.startswith('2') and success is not False:
        data = d.get('data') or {}
        t = data.get('text') or data.get('content') or ''
        t = t.strip()
        if t.startswith('\`\`\`json'): t = t[7:]
        elif t.startswith('\`\`\`'): t = t[3:]
        if t.endswith('\`\`\`'): t = t[:-3]
        text = t.strip()
        if text:
            ok = 'true'
        else:
            err = 'empty text from vision (http ' + http + ')'
    else:
        e = d.get('error') or {}
        msg = e.get('message') or e.get('code') or ('http ' + http)
        # 截短避免 JSON 过长
        err = ('vision call failed: ' + str(msg))[:200]
def esc(s):
    return s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')
print(ok + '\t' + esc(text) + '\t' + esc(err))
" 2>/dev/null)

    VOK=$(printf '%s' "$VMETA" | awk -F'\t' '{print $1}')
    VTEXT=$(printf '%s' "$VMETA" | awk -F'\t' '{print $2}')
    VERR=$(printf '%s' "$VMETA" | awk -F'\t' '{print $3}')

    if [ "$VOK" = "true" ]; then
      export VTEXT
      VPARSED=$(python3 -c "
import json, os
raw = os.environ.get('VTEXT', '')
try:
    d = json.loads(raw)
except Exception:
    d = {}
def pick(k, sub):
    try:
        return str(d.get(k, {}).get(sub, '') or '')
    except Exception:
        return ''
parts = []
for k in ['V1','V2','V3','V4']:
    s = pick(k, 'score')
    r = pick(k, 'reason').replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').replace('\"', \"'\")
    parts.append(s if s else '0')
    parts.append(r)
print('\t'.join(parts))
" 2>/dev/null)

      IFS=$'\t' read -r V1 V1_REASON V2 V2_REASON V3 V3_REASON V4 V4_REASON <<< "$VPARSED"
      case "$V1" in ''|*[!0-9]*) V1=0 ;; esac
      case "$V2" in ''|*[!0-9]*) V2=0 ;; esac
      case "$V3" in ''|*[!0-9]*) V3=0 ;; esac
      case "$V4" in ''|*[!0-9]*) V4=0 ;; esac

      # vision 解析完成但打分全 0 → 视为解析失败（避免无意义触发 FAIL）
      TOTAL=$((V1 + V2 + V3 + V4))
      if [ "$TOTAL" -eq 0 ] && [ -z "$V1_REASON$V2_REASON$V3_REASON$V4_REASON" ]; then
        VOK="false"
        VERR="vision response parse failed (all zero, no reason)"
      fi
    fi

    if [ "$VOK" = "true" ]; then
      SUM_TOTAL=$((SUM_TOTAL + TOTAL))
      NUM_IMGS=$((NUM_IMGS + 1))

      [ "$V1" -le 1 ] && FAIL_ANY_V1=true
      [ "$V3" -le 1 ] && FAIL_ANY_V3=true

      V_PASS=$([ "$TOTAL" -ge 14 ] && echo true || echo false)
      V1_R=$(printf '%s' "$V1_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
      V2_R=$(printf '%s' "$V2_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
      V3_R=$(printf '%s' "$V3_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
      V4_R=$(printf '%s' "$V4_REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
      VOBJ="{\"id\":\"vision-${NAME}\",\"label\":\"${NAME} 4 维\",\"pass\":${V_PASS},\"value\":${TOTAL},\"scores\":{\"V1\":${V1},\"V2\":${V2},\"V3\":${V3},\"V4\":${V4}},\"reasons\":{\"V1\":\"${V1_R}\",\"V2\":\"${V2_R}\",\"V3\":\"${V3_R}\",\"V4\":\"${V4_R}\"}}"
    else
      # vision 调用失败 → graceful degrade：填 0 + reason="vision call failed: ..."
      # 不计入 SUM_TOTAL/NUM_IMGS，不触发 FAIL_ANY_V1/V3，不阻塞 pipeline
      VISION_FAIL_COUNT=$((VISION_FAIL_COUNT + 1))
      ERR_R=$(printf '%s' "$VERR" | sed 's/\\/\\\\/g; s/"/\\"/g')
      VOBJ="{\"id\":\"vision-${NAME}\",\"label\":\"${NAME} 4 维\",\"pass\":true,\"value\":0,\"scores\":{\"V1\":0,\"V2\":0,\"V3\":0,\"V4\":0},\"reasons\":{\"V1\":\"${ERR_R}\",\"V2\":\"${ERR_R}\",\"V3\":\"${ERR_R}\",\"V4\":\"${ERR_R}\"},\"vision_failed\":true}"
    fi

    if [ -z "$VISION_RULES_JSON" ]; then
      VISION_RULES_JSON="$VOBJ"
    else
      VISION_RULES_JSON="${VISION_RULES_JSON},${VOBJ}"
    fi
  done

  if [ "$NUM_IMGS" -gt 0 ]; then
    AVG=$((SUM_TOTAL / NUM_IMGS))
  fi
elif [ "$BASH_OK" = "true" ] && [ "$VISION_ENABLED" != "true" ]; then
  # vision 被显式关闭（BRAIN_VISION_ENABLED=false）：保留 schema 占位
  for img in "${PASSED_IMGS[@]}"; do
    NAME=$(basename "$img")
    VOBJ="{\"id\":\"vision-${NAME}\",\"label\":\"${NAME} 4 维\",\"pass\":true,\"value\":0,\"scores\":{\"V1\":0,\"V2\":0,\"V3\":0,\"V4\":0},\"reasons\":{\"V1\":\"vision endpoint disabled\",\"V2\":\"vision endpoint disabled\",\"V3\":\"vision endpoint disabled\",\"V4\":\"vision endpoint disabled\"}}"
    if [ -z "$VISION_RULES_JSON" ]; then
      VISION_RULES_JSON="$VOBJ"
    else
      VISION_RULES_JSON="${VISION_RULES_JSON},${VOBJ}"
    fi
  done
fi
```

### 步骤 4：裁决（2 层合并）

规则：
- 第 1 层挂 → **FAIL**（PNG 数量不足 / 有小文件）
- 第 2 层进了且 V1 或 V3 出现 ≤ 1 → **FAIL**（只算**打分成功**的图；vision 调用失败的图不参与）
- 第 2 层均分 < 14 → **REVISION**（均分只用打分成功的图计算）
- 第 2 层所有图 vision 都失败（`NUM_IMGS=0`）→ 按第 1 层结果判（不阻塞 pipeline），feedback 带 `vision unavailable: all N calls failed`
- 否则 → **PASS**
- vision 未启用（`BRAIN_VISION_ENABLED=false`）→ 只按第 1 层结果判，verdict 最多是 PASS（占位不影响放行）

```bash
ISSUES=()
COUNT_RULE_PASS="true"
COUNT_REASON=""
if [ "$PNG_COUNT" -lt 8 ]; then
  ISSUES+=("cards 只有 ${PNG_COUNT} 张 PNG, 期望 ≥ 8")
  COUNT_RULE_PASS="false"
  COUNT_REASON=",\"reason\":\"只有 ${PNG_COUNT} 张, 期望 ≥ 8\""
fi
if [ "$SMALL_COUNT" -gt 0 ]; then
  ISSUES+=("${SMALL_COUNT} 张 PNG 小于 10KB（可能空文件）")
fi

COUNT_RULE="{\"id\":\"RCOUNT\",\"label\":\"PNG ≥ 8 张\",\"pass\":${COUNT_RULE_PASS},\"value\":${PNG_COUNT}${COUNT_REASON}}"

if [ "$BASH_OK" != "true" ]; then
  # 第 1 层没过
  VERDICT="FAIL"
  FB_ESC=$(IFS=';'; echo "${ISSUES[*]}" | sed 's/"/\\"/g')
  FEEDBACK="\"${FB_ESC}\""
elif [ "$VISION_CALLED" = "true" ]; then
  # 第 2 层评审了
  if [ "$NUM_IMGS" -eq 0 ]; then
    # 所有图 vision 都失败 → 不阻塞 pipeline，按第 1 层 PASS 放行
    VERDICT="PASS"
    VISION_FB="vision unavailable: ${VISION_FAIL_COUNT} calls failed; fell back to bash-layer verdict"
    FB_ESC=$(printf '%s' "$VISION_FB" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  elif [ "$FAIL_ANY_V1" = "true" ] || [ "$FAIL_ANY_V3" = "true" ]; then
    VERDICT="FAIL"
    VISION_FB="avg=${AVG}/20 (n=${NUM_IMGS}, failed=${VISION_FAIL_COUNT})"
    [ "$FAIL_ANY_V1" = "true" ] && VISION_FB="${VISION_FB}; V1 空字/乱码命中"
    [ "$FAIL_ANY_V3" = "true" ] && VISION_FB="${VISION_FB}; V3 严重裁切/堆叠命中"
    FB_ESC=$(printf '%s' "$VISION_FB" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  elif [ "$AVG" -lt 14 ]; then
    VERDICT="REVISION"
    VISION_FB="vision avg=${AVG}/20 (n=${NUM_IMGS}, failed=${VISION_FAIL_COUNT}) 低于 14 通过线"
    FB_ESC=$(printf '%s' "$VISION_FB" | sed 's/"/\\"/g')
    FEEDBACK="\"${FB_ESC}\""
  else
    VERDICT="PASS"
    if [ "$VISION_FAIL_COUNT" -gt 0 ]; then
      VISION_FB="vision avg=${AVG}/20 (n=${NUM_IMGS}, failed=${VISION_FAIL_COUNT})"
      FB_ESC=$(printf '%s' "$VISION_FB" | sed 's/"/\\"/g')
      FEEDBACK="\"${FB_ESC}\""
    else
      FEEDBACK="null"
    fi
  fi
else
  # 第 1 层全过但第 2 层显式关闭（BRAIN_VISION_ENABLED=false）
  VERDICT="PASS"
  FEEDBACK="null"
fi
```

### 步骤 5：输出 JSON

```bash
# rule_details 顺序：RCOUNT（整体）+ per-image size + per-image vision
if [ -z "$PER_IMAGE_JSON" ]; then
  RULES="${COUNT_RULE}"
else
  RULES="${COUNT_RULE},${PER_IMAGE_JSON}"
fi
if [ -n "$VISION_RULES_JSON" ]; then
  RULES="${RULES},${VISION_RULES_JSON}"
fi

echo "{\"image_review_verdict\":\"${VERDICT}\",\"image_review_feedback\":${FEEDBACK},\"card_count\":${PNG_COUNT},\"vision_avg\":${AVG},\"vision_threshold\":14,\"vision_enabled\":${VISION_ENABLED},\"vision_scored_count\":${NUM_IMGS},\"vision_failed_count\":${VISION_FAIL_COUNT},\"image_review_rule_details\":[${RULES}]}"
```

## 禁止事项

- 禁止因"感觉"判 FAIL（第 1 层纯机械，第 2 层交给 vision LLM）
- 禁止自己打 V1-V4 的分（必须 vision 端点打分）
- 禁止"反复评分 / 自我重试"；一次调用，解析失败按 0 算
- 禁止在 JSON 外输出任何东西
- **禁止私自改写 `vision_enabled` / `vision_scored_count` / `vision_failed_count` / 每张图的 reason 内容**。这些字段由 bash 脚本自己产生（包括 vision 调用失败时的 `"vision call failed: ..."`）。你只是 copy-paste bash 代码的搬运工，不是"聪明的降级者"。
- **禁止看到第一张图 vision 返回 error 就跳过后续循环**——每张图必须独立调用一次 vision，失败由 bash 逻辑 graceful degrade 到占位（`vision_failed:true`、填 0、reason 带具体 error message），避免一两次瞬时故障吞掉所有图的评分

## 输出 schema

唯一 stdout 最后一行：

```json
{
  "image_review_verdict":"PASS|REVISION|FAIL",
  "image_review_feedback":"..."|null,
  "card_count":<int>,
  "vision_avg":0-20,
  "vision_threshold":14,
  "vision_enabled":true|false,
  "vision_scored_count":<int>,
  "vision_failed_count":<int>,
  "image_review_rule_details":[
    {"id":"RCOUNT","label":"PNG ≥ 8 张","pass":true|false,"value":<int>,"reason"?:"..."},
    {"id":"<filename>.png","label":"<filename>.png","pass":true|false,"value":<size_bytes>,"reason"?:"..."},
    ...,
    {"id":"vision-<filename>.png","label":"<filename>.png 4 维","pass":true|false,"value":0-20,"scores":{"V1":0-5,"V2":0-5,"V3":0-5,"V4":0-5},"reasons":{"V1":"...","V2":"...","V3":"...","V4":"..."},"vision_failed"?:true},
    ...
  ]
}
```

## 与 Brain 的接口契约（vision）

- **目标端点**：`POST ${BRAIN_URL}/api/brain/llm-service/vision`
- 请求体：`{ tier, prompt, image_base64, image_mime, max_tokens, format, timeout }`
- tier：`thalamus`（Sonnet 级，成本受控）
- 成功响应：`{ success: true, data: { text: "<严格 JSON 字符串>", ... } }`
- 失败响应：`{ success: false, data: null, error: { code, message } }`（本 skill 的 bash 会检测 `success: false` 或非 2xx HTTP，给这张图 graceful degrade）

## 现状：vision 端点已上线（2026-04-20）

**结论**：Brain 侧 `POST /api/brain/llm-service/vision` 已上线（cecelia PR #2473），本 skill 默认启用第 2 层。

- `cecelia/packages/brain/src/routes/llm-service.js` 暴露 `POST /vision`，请求体 `{ tier, prompt, image_base64, image_mime, max_tokens, format, timeout }`。
- 底层复用 `callLLM` 的 `options.imageContent`（Anthropic 多模态 content block 格式），走 `anthropic-api` provider 直连。
- tier 白名单仅 `thalamus | cortex`（只有 Claude 级支持多模态），pipeline-review 固定用 `thalamus`（成本受控）。
- image 硬上限 5MB（base64 字符 ~6.99M），超过返回 413 `IMAGE_TOO_LARGE`。

## 失败处理（Graceful Degrade）

端点调用可能因多种原因失败（账号余额不足、timeout、413 超大、Brain 服务重启等）。本 skill 在这些情况下**不阻塞 pipeline**：

| 情况 | skill 行为 |
|---|---|
| 单张图 vision 失败 | 该图填 V1=V2=V3=V4=0，reason 带具体 error message（如 `vision call failed: credit balance too low`），`vision_failed:true`。**不触发** `FAIL_ANY_V1/V3`，**不计入** `SUM_TOTAL/NUM_IMGS` 均分计算 |
| 部分图失败（≥1 张成功） | verdict 按成功图的均分判（FAIL/REVISION/PASS），feedback 带 `failed=<N>` 计数 |
| 全部图失败（`NUM_IMGS=0`） | verdict 降级为第 1 层 PASS，feedback 带 `vision unavailable: N calls failed; fell back to bash-layer verdict`，不阻塞管线 |
| vision 端点显式关闭 | 设 `BRAIN_VISION_ENABLED=false`，直接走占位（`reason="vision endpoint disabled"`），不调 curl |

**紧急回退**：如果要完全关闭 vision（比如 Anthropic 账号整段时间没额度），在 task payload 或 pipeline env 里设置 `BRAIN_VISION_ENABLED=false` 即可。
