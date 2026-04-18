---
name: pipeline-ops-stage-generate
description: /pipeline-regen、重生图、V6 出图失败 — Content Pipeline Stage 4 (V6 图片生成) 运维 skill
---

# /pipeline-regen — Stage 4 V6 生图运维 skill

## 什么时候用
- V6 脚本 subprocess 超时 / non-zero exit
- 想换模板参数重生
- cards/ 下 PNG 数 < 9 张
- 图 layout 坏了（比如某块位置错位，但文字内容是 ok 的）

## 前置检查

```bash
# 1. V6 脚本存在
ls -la /Users/administrator/claude-output/scripts/gen-v6-person.mjs

# 2. node + @resvg/resvg-js 可用
node --version
node -e "import('@resvg/resvg-js').then(m=>console.log('resvg OK'))" 2>&1 | head -3

# 3. person-data.json 合规（不含占位符）
OUT_DIR="<output_dir>"
grep -cE "待补充|暂无数据|待产出" "${OUT_DIR}/cards/person-data.json" 2>/dev/null
# 期望 0；若 ≠ 0 先跑 /pipeline-persondata
```

## 介入步骤

### 步骤 1: 清旧 PNG（必做）

```bash
OUT_DIR="<output_dir>"
rm -f ~/claude-output/images/*.png
rm -f "${OUT_DIR}/cards/"*.png
```

### 步骤 2: 运行 V6 脚本

```bash
KEYWORD="<关键词>"
KEYWORD_SLUG=$(python3 -c "
import re
print(re.sub(r'-+', '-', re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff-]', '-', '${KEYWORD}'))[:40])
")

node /Users/administrator/claude-output/scripts/gen-v6-person.mjs \
  --data "${OUT_DIR}/cards/person-data.json" \
  --slug "${KEYWORD_SLUG}"
```

产物（固定 9 张 → `~/claude-output/images/`）：

| 文件 | 尺寸 | 用途 |
|------|------|------|
| `<slug>-cover.png` | 1080×1464 | 社交媒体封面 |
| `<slug>-01-profile.png` | 1080×1920 | 人物档案（数据+时间线） |
| `<slug>-02-flywheel.png` | 1080×1920 | 核心方法论飞轮 |
| `<slug>-03-day.png` | 1080×1920 | 真实一天 |
| `<slug>-04-qa.png` | 1080×1920 | Q&A + CTA |
| `<slug>-lf-cover.png` | 900×383 | 长文封面配图 |
| `<slug>-lf-01.png` | 1080×810 | 长文配图1（关键数据） |
| `<slug>-lf-02.png` | 1080×810 | 长文配图2（时间线） |
| `<slug>-lf-03.png` | 1080×810 | 长文配图3（飞轮） |

### 步骤 3: cp 到 pipeline cards/

```bash
cp ~/claude-output/images/${KEYWORD_SLUG}-*.png "${OUT_DIR}/cards/"
ls "${OUT_DIR}/cards/"*.png | wc -l  # 期望 9
```

## 可选：换模板

V6 脚本硬编码在 gen-v6-person.mjs 里。主理人想换模板通常复制新 `gen-dankoe-v7-xxx.mjs`，然后临时改 generate.py 里的 `GEN_V6_SCRIPT` env 指向：

```bash
# 临时跑个一次
node /Users/administrator/claude-output/scripts/gen-dankoe-v6.mjs \
  --data "${OUT_DIR}/cards/person-data.json" \
  --slug "${KEYWORD_SLUG}"
```

## 验收标准

```bash
# 9 张 PNG 齐
ls "${OUT_DIR}/cards/"*.png | wc -l  # == 9

# 每张图尺寸正确
for f in "${OUT_DIR}/cards/"*.png; do
  sips -g pixelWidth -g pixelHeight "$f" | grep -E "pixelWidth|pixelHeight" | tr '\n' ' '
  echo "  $(basename $f)"
done
```

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| `V6 生成器异常: timeout` | node 脚本超 180s | 检查 person-data 字段长度是否过长；资源不足可 kill 其他 node 进程 |
| 头像圈空白/首字母不对 | `avatar_b64_file=null`（默认） | 这是预期行为；想要真头像需手动填 base64 路径 |
| 中文字体显示方块 | node-canvas 字体缺失（V6 用 resvg 一般没这问题） | `brew install --cask font-noto-sans-sc` |
| PNG 生成但内容老 | 没清 `~/claude-output/images/` | 步骤 1 必须跑 |
| slug 里带奇怪字符 | `_slug()` 正则没处理干净 | keyword 里移掉标点再跑 |
| cards/ 下只有 person-data.json 没 PNG | 没执行 cp | 步骤 3 必须跑 |

## 相关文件路径
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/generate.py`
- V6 脚本: `/Users/administrator/claude-output/scripts/gen-v6-person.mjs`
- V6 产物中转: `~/claude-output/images/`
- pipeline cards 目标: `<output_dir>/cards/`
- person-data 字段预算: `pipeline_worker/person_data_builder.py` `BUDGET` dict
