---
name: pipeline-copywrite
description: /pipeline-copywrite、重写文案、copy.md 不满意 — Content Pipeline Stage 2 (LLM 写稿) 运维 skill
---

# /pipeline-copywrite — Stage 2 文案运维 skill

## 什么时候用
- `copy.md` / `article.md` 写出来半截（LLM 超 token 截断）
- 文案违反品牌规则（copy_review 报禁用词）
- 想人工调整 prompt 限制 findings 数量
- LLM 报 "LLM 输出不符格式要求" （社交 <200 字或长文 <500 字）

## 前置检查

```bash
# Cecelia brain 5221 在
curl -s http://localhost:5221/api/brain/status | head -c 200

# 定位输出目录
KEYWORD="<关键词>"
ls -d ~/content-output/*${KEYWORD}* 2>/dev/null | head
```

## 介入步骤

### 步骤 1: 设 auth + 构造 prompt

```bash
# token 用 /credentials skill 获取 CECELIA_INTERNAL_TOKEN
OUT_DIR="<上面找到的目录，如 ~/content-output/2026-04-18-xxx>"
KEYWORD="<关键词>"

# 从 findings.json 取前 N 条（限制 5 条避免 prompt 超长）
N_FINDINGS=5
FINDINGS=$(python3 -c "
import json, glob, re
slug = re.sub(r'-+', '-', re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff-]', '-', '${KEYWORD}'))[:40]
for fp in glob.glob('/Users/administrator/content-output/research/*-' + slug + '-*/findings.json'):
    data = json.load(open(fp))
    fs = data.get('findings', [])[:${N_FINDINGS}]
    print('\n'.join(f'{i+1}. {f.get(\"title\",\"\")}: {(f.get(\"content\") or \"\")[:1000]}' for i,f in enumerate(fs)))
    break
")
echo "$FINDINGS" | head -20
```

### 步骤 2: 调 Cecelia LLM 重写

```bash
cat > /tmp/copywrite-prompt.txt <<PROMPTEOF
你是一位专业的内容创作者，擅长将调研素材转化为高质量的社交媒体文案和深度长文。

## 任务
为「${KEYWORD}」创作两个版本的内容：
1. 社交媒体文案（小红书/抖音风格，500-800字，口语化，含互动引导）
2. 公众号长文（深度分析，1500-2000字，结构清晰）

## 调研素材
${FINDINGS}

请严格按以下格式输出，不要省略分隔符：
=== 社交媒体文案 ===
[500-800字]
=== 公众号长文 ===
[1500-2000字]

禁止：询问用户、输出选项、说"需要更多信息"。
PROMPTEOF

PROMPT=$(python3 -c 'import json,sys; print(json.dumps(open("/tmp/copywrite-prompt.txt").read()))')

curl -s -X POST http://localhost:5221/api/brain/llm-service/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}" \
  -d "{\"tier\":\"thalamus\",\"prompt\":${PROMPT},\"max_tokens\":8192}" \
  > /tmp/copywrite-resp.json

# 提取 text（兼容新旧格式）
python3 -c '
import json
r = json.load(open("/tmp/copywrite-resp.json"))
payload = r.get("data") if isinstance(r.get("data"), dict) else r
text = payload.get("text") or payload.get("content","")
open("/tmp/copywrite-text.md","w").write(text)
print(f"{len(text)} chars written to /tmp/copywrite-text.md")
'
```

说明：`tier=thalamus` 走 anthropic-api+bridge（稳定）；`cortex` 走 codex（sandbox 有时失败）。

### 步骤 3: 切分 + 塞回 pipeline 目录

```bash
python3 - <<PYEOF
import re
from pathlib import Path

KEYWORD = "${KEYWORD}"
OUT_DIR = Path("${OUT_DIR}")
text = Path("/tmp/copywrite-text.md").read_text("utf-8")

social = re.search(r"=== 社交媒体文案 ===([\s\S]*?)(?:=== 公众[号]?长文 ===|$)", text)
article = re.search(r"=== 公众[号]?长文 ===([\s\S]*?)$", text)
social_txt = (social.group(1).strip() if social else "").strip()
article_txt = (article.group(1).strip() if article else "").strip()

assert len(social_txt) >= 200, f"社交文案太短：{len(social_txt)} < 200"
assert len(article_txt) >= 500, f"长文太短：{len(article_txt)} < 500"

(OUT_DIR / "cards").mkdir(parents=True, exist_ok=True)
(OUT_DIR / "article").mkdir(parents=True, exist_ok=True)
(OUT_DIR / "cards" / "copy.md").write_text(
    f"# {KEYWORD}：社交媒体文案\n\n{social_txt}\n", encoding="utf-8")
(OUT_DIR / "article" / "article.md").write_text(
    f"# {KEYWORD}：深度分析\n\n{article_txt}\n", encoding="utf-8")
print("OK → copy.md, article.md")
PYEOF
```

## 验收标准

```bash
# 字数满足门槛
wc -m "${OUT_DIR}/cards/copy.md" "${OUT_DIR}/article/article.md"
# 期望: copy.md ≥ 200 字, article.md ≥ 500 字

# 无禁用词
grep -E "coding|搭建|agent workflow|builder|Cecelia|智能体搭建|代码部署" \
  "${OUT_DIR}/cards/copy.md" "${OUT_DIR}/article/article.md" && echo "FAIL" || echo "PASS"

# 品牌关键词覆盖 ≥ 2
cat "${OUT_DIR}/cards/copy.md" "${OUT_DIR}/article/article.md" | \
  grep -oE "能力|系统|一人公司|小组织|AI|能力下放|能力放大" | sort -u | wc -l
```

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| LLM 输出半截 | max_tokens 不够（默认 8192） | 请求调 16384 或 32000 |
| 格式不符（缺分隔符） | LLM 忽略 prompt 格式 | 加强 prompt "必须包含 === 社交媒体文案 === 和 === 公众号长文 ===" |
| Cecelia 5221 返回 {text: ""} | tier=cortex 本机 sandbox 失败 | 换 `tier=thalamus` |
| curl 401 UNAUTHORIZED | Authorization header 丢了 | 带上 Bearer token |
| findings 为空 | research 阶段没跑 | 先走 /pipeline-research |
| 禁用词误伤（如 "AI" 不是禁用词） | grep 规则检查精确 | 禁用词见 `copy_review.py` `BANNED_WORDS` |

## 相关文件路径
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/copywriting.py`
- Review: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/copy_review.py`
- 输出位置: `<out_dir>/cards/copy.md` + `<out_dir>/article/article.md`
- LLM 接口: `POST http://localhost:5221/api/brain/llm-service/generate`（tier=thalamus）
