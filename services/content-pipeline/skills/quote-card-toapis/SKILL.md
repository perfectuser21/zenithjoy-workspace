---
name: quote-card-toapis
description: 使用 ToAPIs 生成金句卡片（1:1 正方形，黑底橙红风格）
version: 2.0.0
created: 2026-02-13
---

# Quote Card Generator (ToAPIs)

使用 ToAPIs API 生成金句卡片，风格参考 reference-match-v6.png

## 图片规范

### 基础设置
- **比例**: 1:1 (1024x1024)
- **生成时间**: ~20-30秒
- **文件大小**: ~300KB

### 视觉风格（参考 reference-match-v6.png）
- **背景**: 纯黑色 (#0a0a0a)
- **主标题**: 白色/米白色，大字体
- **强调文字**: 橙红色 (#A95738)
- **图标**: 2个简约扁平图标，橙红色
- **版式**: 简约现代，大量留白

## 使用方法

### 方式 1：直接调用脚本

```bash
python3 scripts/toapis-image-gen.py \
  "Create 1:1 quote card: black bg, white title '你的标题', orange-red '强调文字', 2 simple icons" \
  -s 1024x1024
```

### 方式 2：使用模板函数

```bash
# 生成金句卡片
bash scripts/generate-quote-card.sh "标题" "强调文字"
```

## Prompt 模板

```
Create a 1:1 square social media quote card in this exact style:

STYLE REFERENCE:
- Pure black background (#0a0a0a)
- Large white/off-white title text at top
- Orange-red (#A95738) emphasized text below
- 2 simple flat minimalist icons in orange-red
- Clean typography, bold sans-serif font
- Plenty of negative space
- Minimal, modern, impactful design

CONTENT:
Title (white): {你的标题}
Emphasized (orange-red): {强调文字}
Icons: {图标描述}
```

## 示例

### 输入
```
标题: 真正的竞争力
强调: 不是会用 AI，而是知道什么时候不用 AI
图标: brain, target
```

### 输出
- 文件: `output/toapis-cards/card-YYYYMMDD-HHMMSS.png`
- 尺寸: 1024x1024
- 大小: ~300KB

## 参考图位置

`/home/xx/perfect21/zenithjoy/creator/assets/cards/reference-match-v6.png`

## 优势

相比原 ChatGPT 方案：
- ✅ 无需 SSH 隧道
- ✅ 无需上传参考图
- ✅ 速度更快（20秒 vs 60秒+）
- ✅ 稳定可靠
- ✅ 完全自动化

## 集成到工作流

### N8N Workflow 节点

```javascript
// 节点：生成金句卡片
{
  "command": "python3 /home/xx/perfect21/zenithjoy/creator/scripts/toapis-image-gen.py \"Create 1:1 quote card: black bg, white title '{{ $json.title }}', orange-red '{{ $json.quote }}', 2 simple icons\" -s 1024x1024 -o /tmp/quote-{{ $json.content_id }}.png"
}
```

### Bash 工作流

```bash
# 生成金句卡片
python3 scripts/toapis-image-gen.py \
  "Create 1:1 quote card: black bg, white title '$TITLE', orange-red '$QUOTE', 2 icons" \
  -s 1024x1024 \
  -o "/tmp/quote-${CONTENT_ID}.png"
```

## 相关文件

- 脚本: `scripts/toapis-image-gen.py`
- 参考图: `assets/cards/reference-match-v*.png`
- 凭据: `~/.credentials/toapi.env`

