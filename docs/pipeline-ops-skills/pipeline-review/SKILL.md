---
name: pipeline-review
description: /pipeline-review、审图、vision 审查 — Content Pipeline Stage 5 (图片审查) 运维 skill，手动跑 Claude Vision 检查文字溢出/布局错位
---

# /pipeline-review — Stage 5 图片审查运维 skill

## 什么时候用
- 想在 pipeline 外手动跑 vision 审图（比如换模板后）
- image_review 报 `vision major severity`，想看具体 issue
- Anthropic API quota 耗尽，vision 被 skip 了
- 想跳过 vision 强推（设 `SKIP_VISION_REVIEW=1`）

## 前置检查

```bash
# 1. Anthropic API key 在 1Password 和 ~/.credentials/anthropic.json 双写
ls -la ~/.credentials/anthropic.json
# 注意：不要 cat 内容，只看存在

# 2. 余额 / rate limit（用 /llm-quota skill 查 5h / 7d 配额）

# 3. 要审的 PNG
OUT_DIR="<output_dir>"
ls "${OUT_DIR}/cards/"*.png | wc -l
```

## 介入步骤

### 步骤 1: Python one-liner 跑 review_images

```bash
cd /Users/administrator/perfect21/zenithjoy/services/creator
OUT_DIR="<output_dir>"

PYTHONPATH=. python3 - <<PYEOF
import json
from pathlib import Path
from pipeline_worker.image_vision_review import review_images

paths = sorted((Path("${OUT_DIR}") / "cards").glob("*.png"))
print(f"审 {len(paths)} 张图…")
report = review_images(paths)
print(json.dumps(report, ensure_ascii=False, indent=2))
PYEOF
```

**期望输出格式**：

```json
{
  "review_passed": true,
  "checked": 9,
  "skipped": 0,
  "issues": [],
  "per_image": [
    {"image": "xxx-cover.png", "pass": true, "severity": "ok", "issues": [], "status": "reviewed"},
    ...
  ],
  "severity": "ok"
}
```

- `severity=major` → pipeline 会 FAIL，必须修
- `severity=minor` → pipeline 会 PASS，但值得关注
- `skipped > 0` → API key 丢了或网络挂

### 步骤 2: 单图深度检查（选做）

```bash
IMG="${OUT_DIR}/cards/xxx-01-profile.png"
cd /Users/administrator/perfect21/zenithjoy/services/creator
PYTHONPATH=. python3 -c "
from pathlib import Path
from pipeline_worker.image_vision_review import review_images
print(review_images([Path('${IMG}')]))
"
```

### 步骤 3: 跳过 vision 强推（应急）

```bash
# 只临时用，记得跑完清掉
export SKIP_VISION_REVIEW=1
# 然后重跑 image_review
cd /Users/administrator/perfect21/zenithjoy/services/creator
PYTHONPATH=. python3 -c "
from pipeline_worker.executors.image_review import execute_image_review
print(execute_image_review({'keyword': '<关键词>', 'image_count': 9}))
"
unset SKIP_VISION_REVIEW
```

## 验收标准

```bash
# review_passed=True + severity=ok|minor
```

跑完记录三个数：
- `checked`：真被 vision 看过几张
- `skipped`：因 API 错误跳过几张
- `severity`：聚合等级

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| `找不到 ANTHROPIC_API_KEY，跳过视觉检查` | `~/.credentials/anthropic.json` 缺 | 用 /credentials skill 从 1Password CS Vault 恢复 |
| 所有图都 skipped | API 401 或 rate limit | 用 /llm-quota skill 查配额；换 5h cycle 后重试 |
| severity=major 但人眼看没问题 | vision 对"文字贴边"敏感 | 调大 V6 卡片 padding；或确认是误判 |
| JSON 解析失败 `%s; 前 200 字` | Claude 输出非纯 JSON | 默认 prompt 已强制纯 JSON；若偶发，重跑一次 |
| `HTTP 529 Overloaded` | API 抖动 | 等 1 分钟重试 |
| pipeline 卡 45s/张 | `PER_IMAGE_TIMEOUT_SEC=45` 且串行 | 预期行为，9 张 ≈ 5 分钟 |

## 相关文件路径
- Vision 模块: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/image_vision_review.py`
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/image_review.py`
- 凭据（/credentials skill 管理）: `~/.credentials/anthropic.json`
- 环境变量: `IMAGE_VISION_MODEL`（默认 `claude-sonnet-4-5`）、`SKIP_VISION_REVIEW=1` 跳过
