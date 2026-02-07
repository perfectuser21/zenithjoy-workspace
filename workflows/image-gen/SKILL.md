---
id: image-gen-workflow
version: 1.0.0
created: 2026-01-29
updated: 2026-01-29
changelog:
  - 1.0.0: 初始版本
---

# Image Generation Workflow

通过 Mac Mini 远程控制 ChatGPT/Gemini 生成高质量配图，自动评分筛选后发送到飞书。

## 触发方式

用户说：`/image-gen` 或 "帮我生成配图"、"做一张图"

## 输入

```yaml
reference_images:    # 参考图片路径（可选，1-3张）
  - /path/to/ref1.png
  - /path/to/ref2.png

content: |           # 文案内容（必需）
  真诚才是流量密码

style_notes: |       # 风格说明（可选）
  深色背景，金色/橙色文字，简约高级感

target_group: "悦升云端"  # 发送目标群（可选）
quality_threshold: 8      # 质量阈值（1-10，默认8）
max_retries: 3            # 最大重试次数（默认3）
```

## 流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Image Gen Workflow                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 分析参考图                                               │
│     └── Claude 看图，提取风格特征                            │
│                                                             │
│  2. 构建 Prompt                                              │
│     └── 参考图风格 + 文案 + 用户指令 → 完整 prompt           │
│                                                             │
│  3. 发送到 AI                                                │
│     ├── ChatGPT (DALL-E 3) - 默认                           │
│     └── Gemini (Imagen) - 备选                              │
│                                                             │
│  4. 提取生成图片                                             │
│     └── CDP 截取/下载图片到本地                              │
│                                                             │
│  5. 质量评分                                                 │
│     └── Claude 评分 (1-10)                                  │
│         ├── 风格匹配度                                       │
│         ├── 文字清晰度                                       │
│         ├── 整体美观度                                       │
│         └── 专业感                                          │
│                                                             │
│  6. 决策                                                    │
│     ├── ≥ threshold → 发送到飞书                            │
│     └── < threshold → 重试（最多 max_retries 次）           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 依赖

- SSH 连接到 Mac Mini (`ssh mac-mini`)
- Mac Mini 上 Chrome 开启 debug 模式 (端口 9222)
- SSH 隧道: `ssh -f -N -L 19222:localhost:9222 mac-mini`
- ChatGPT/Gemini 已登录
- 飞书客户端已登录

## 脚本位置

```
skills/image-gen-workflow/
├── SKILL.md              # 本文档
├── scripts/
│   ├── ensure-tunnel.sh      # 确保 SSH 隧道
│   ├── send-to-chatgpt.py    # 发送到 ChatGPT
│   ├── send-to-gemini.py     # 发送到 Gemini
│   ├── extract-image.py      # 提取生成的图片
│   └── send-to-feishu.sh     # 发送到飞书
└── examples/
    └── style-refs/           # 参考图样例
```

## 使用示例

### 基础用法

```
/image-gen
参考图: /tmp/ref-style.png
文案: 真诚才是流量密码
```

### 指定风格

```
/image-gen
参考图:
  - /tmp/dark-gold-1.png
  - /tmp/dark-gold-2.png
文案: 做内容的正确路径是曝光-信任-结果
风格: 深色背景，金色渐变文字，极简布局
质量要求: 9分以上
发送到: 悦升云端
```

### 批量生成

```
/image-gen --batch
文案列表:
  - 真诚才是流量密码
  - 曝光 → 信任 → 结果
  - 内容即产品
参考风格: /tmp/style-ref.png
```

## 评分标准

| 维度 | 权重 | 说明 |
|------|------|------|
| 风格匹配 | 30% | 与参考图风格一致性 |
| 文字清晰 | 25% | 中文渲染质量，无错别字 |
| 整体美观 | 25% | 构图、配色、平衡感 |
| 专业感 | 20% | 是否有高级感、品牌感 |

**评分说明：**
- 9-10分：完美，直接发布
- 8分：优秀，可发布
- 6-7分：一般，建议重试
- <6分：不合格，必须重试

## 常见问题

### SSH 隧道断开
```bash
# 重建隧道
ssh -f -N -L 19222:localhost:9222 mac-mini
```

### Chrome 未开启 debug 模式
```bash
# 在 Mac Mini 上执行
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug
```

### 飞书发送失败
检查飞书客户端是否在前台，必要时手动激活后重试。
