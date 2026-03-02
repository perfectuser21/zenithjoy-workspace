---
name: posts
description: 金句卡片生成工作流的质检和选择
trigger: 当需要质检内容、选金句、质检卡片时
version: 1.0.0
created: 2026-01-30
---

# Posts Skill

金句卡片生成工作流的 3 个质检节点。

## 子命令

### /posts qa-content
质检 Deep Post 和 Broad Post 内容。

**输入**: 内容文本
**输出**: JSON `{"score": 1-10, "passed": true/false, "reason": "原因"}`

**评分标准**:
- 内容完整性 (Deep 5-8句, Broad 2-3句)
- 观点清晰度
- 语言简洁有力
- 适合社交媒体发布

**通过标准**: score >= 7

---

### /posts qa-quote
从多个金句中选择最适合做卡片的一个。

**输入**: 5-10 个金句（每行一个）
**输出**: JSON `{"selected": "最佳金句", "reason": "选择原因"}`

**选择标准**:
- 10-20 字最佳
- 有冲击力和记忆点
- 适合视觉呈现
- 独立可理解（不依赖上下文）

---

### /posts qa-card
质检生成的金句卡片图片。

**输入**: 图片文件路径
**输出**: JSON `{"score": 1-10, "passed": true/false, "reason": "原因"}`

**评分标准**:
| 维度 | 检查项 | 权重 |
|------|--------|------|
| 配色 | 黑底 + 橘红强调 #A95738 + 米白主字 | 25% |
| 比例 | 1:1 正方形 | 10% |
| 图标 | 2个抽象图标，无文字 | 15% |
| 文字 | 金句完整显示，可读性好 | 30% |
| 风格 | 与参考图一致，扁平简洁 | 20% |

**通过标准**: score >= 7

---

## 使用方式

```bash
# 在 cecelia-workflows 目录下
cd /home/xx/dev/cecelia-workflows

# 质检内容
claude -p "/posts qa-content
内容如下：
..."

# 选金句
claude -p "/posts qa-quote
金句列表：
1. xxx
2. xxx
..."

# 质检卡片（带图片）
claude -p "/posts qa-card" --files /tmp/card.png
```

## N8N 集成

工作流: `[Flow] 金句卡片生成器 v5.0 (Claude质检)`

每个质检节点调用对应的子命令。
