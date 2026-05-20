---
id: image-gen-workflow
version: 3.0.0
created: 2026-01-29
updated: 2026-02-04
changelog:
  - 3.0.0: 分离生成和质检，Claude Code 负责质检和重试循环
  - 2.0.0: 使用 agent-browser 重写，增加图片点击和下载功能
  - 1.0.0: 初始版本
---

# Image Generation Workflow

通过 Mac Mini 远程控制 ChatGPT 生成高质量配图，Claude 质检，不合格自动重试。

## 核心架构

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   Claude Code (US VPS)                                       │
│      │                                                       │
│      ├── 1. 调用 chatgpt-generate.sh (在 HK VPS 执行)         │
│      │      └── 上传参考图 → 发送 prompt → 等待 → 下载        │
│      │                                                       │
│      ├── 2. 读取生成的图片                                    │
│      │                                                       │
│      ├── 3. 质检 (Claude 看图评分)                            │
│      │      ├── 合格 → 完成                                   │
│      │      └── 不合格 → 回到步骤 1 (--regenerate)            │
│      │                                                       │
│      └── 4. 发送到飞书 (可选)                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**关键设计**：
- 脚本只负责生成和下载，不做质检
- Claude Code 负责质检（可以直接看图）
- 不合格时 Claude Code 调用 `--regenerate` 重试

## 触发方式

用户说：`/image-gen` 或 "帮我生成配图"、"做一张图"

## 脚本说明

### chatgpt-generate.sh

**位置**：`scripts/chatgpt-generate.sh` (已部署到 HK VPS `/home/ubuntu/scripts/`)

**用法**：
```bash
# 基础用法
ssh hk "/home/ubuntu/scripts/chatgpt-generate.sh '你的prompt'"

# 带参考图
ssh hk "/home/ubuntu/scripts/chatgpt-generate.sh '参考这些图风格生成金句卡片：真诚才是流量密码' \
    --refs /tmp/ref1.jpg /tmp/ref2.jpg /tmp/ref3.jpg /tmp/ref4.jpg \
    --output /tmp/result.png"

# 重新生成（保持当前对话）
ssh hk "/home/ubuntu/scripts/chatgpt-generate.sh --regenerate --output /tmp/result2.png"
```

**参数**：
| 参数 | 说明 |
|------|------|
| `"prompt"` | 生成 prompt（第一个位置参数） |
| `--refs` | 参考图列表（之后的参数都是参考图） |
| `--output` | 输出路径（默认 /tmp/chatgpt-时间戳.png） |
| `--regenerate` | 重新生成模式（不新建对话） |
| `--timeout` | 超时秒数（默认 180） |

**输出**：
- 成功时最后一行：`OUTPUT=/path/to/result.png`
- 图片同时保存在 HK VPS 和 Mac mini Downloads

## 完整流程示例

### 1. 准备参考图（如果有）

```bash
# 把参考图复制到 Mac mini /tmp
scp /path/to/ref1.jpg mac-mini:/tmp/ref1.jpg
scp /path/to/ref2.jpg mac-mini:/tmp/ref2.jpg
# ... 最多 4 张
```

### 2. 调用生成脚本

```bash
ssh hk "/home/ubuntu/scripts/chatgpt-generate.sh \
    '严格参考这些图片的风格生成金句卡片。
文案：真诚才是流量密码
要求：
1. 纯黑色背景
2. 米白色/奶油色文字（不要金色）
3. 橙红色突出重点词
4. 底部加橙色波浪线装饰
5. 简约扁平风格' \
    --refs /tmp/ref1.jpg /tmp/ref2.jpg /tmp/ref3.jpg /tmp/ref4.jpg \
    --output /tmp/gen-result.png"
```

### 3. 下载并质检

```bash
# 从 HK VPS 下载到本地
scp hk:/tmp/gen-result.png /tmp/gen-result.png

# Claude 查看图片质检（Read tool）
```

### 4. 不合格则重试

```bash
# 如果不合格，重新生成
ssh hk "/home/ubuntu/scripts/chatgpt-generate.sh --regenerate --output /tmp/gen-result-v2.png"
```

## 质检标准

| 维度 | 权重 | 说明 |
|------|------|------|
| 风格匹配 | 30% | 与参考图风格一致性 |
| 文字清晰 | 25% | 中文渲染质量，无错别字 |
| 整体美观 | 25% | 构图、配色、平衡感 |
| 专业感 | 20% | 是否有高级感、品牌感 |

**评分说明**：
- 9-10分：完美，直接发布
- 7-8分：优秀，可发布
- 5-6分：一般，建议重试
- <5分：不合格，必须重试

## 网络架构

```
US VPS (Claude Code)
    │
    └── SSH → HK VPS (agent-browser)
                  │
                  └── SSH 隧道 9222 → Mac mini Chrome
                                          │
                                          └── FlClash → ChatGPT
```

### 关键连接

| 连接 | 方式 | 说明 |
|------|------|------|
| US → HK | Tailscale SSH | `ssh hk` |
| HK → Mac mini | SSH 隧道 | 端口 9222 转发 |
| Mac mini → ChatGPT | FlClash | HK-Relay-US 节点 |

## 脚本文件

```
skills/image-gen-workflow/
├── SKILL.md                       # 本文档
└── scripts/
    ├── chatgpt-generate.sh        # ★ 主脚本：生成 + 下载
    ├── chatgpt-gen-with-qc.sh     # 带内置质检版本（需 API key）
    ├── chatgpt-with-refs.sh       # 旧版：带参考图上传
    ├── ensure-tunnel.sh           # SSH 隧道工具
    └── send-to-feishu.sh          # 发送到飞书
```

## 常见问题

### 上传参考图失败

osascript 需要 Chrome 文件对话框在前台。检查：
1. Mac mini 屏幕没有被其他窗口遮挡
2. Chrome 是当前活跃应用

### 下载图片为空

canvas 跨域问题。使用 Download 按钮方式下载（脚本已改用此方式）。

### ChatGPT 被封

检查 FlClash 代理节点，使用 HK-Relay-US（香港中转美国出口）。

### SSH 隧道断开

```bash
# 在 HK VPS 上重建隧道
ssh hk "ssh -f -N -L 9222:127.0.0.1:9222 mac-mini"
```

### Chrome 未响应

重启 Chrome debug 模式：
```bash
ssh mac-mini "pkill -f 'Chrome.*remote-debugging' || true"
ssh mac-mini "nohup /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug &"
```
