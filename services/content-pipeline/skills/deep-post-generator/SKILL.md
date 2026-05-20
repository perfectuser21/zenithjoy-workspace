---
id: deep-post-generator
version: 1.0.0
created: 2026-02-01
updated: 2026-02-01
changelog:
  - 1.0.0: 初始版本 - NotebookLM 生成内容 + ChatGPT 生成配图
---

# Deep Post Generator

从零生成 Deep Post 内容 + 高级配图的完整工作流。

## 触发词

`/deep-post-gen` 或 "生成 Deep Post"、"批量生成深度帖"

## 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                  Deep Post Generator Workflow                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. NotebookLM 生成内容                                      │
│     ├─ 使用 "帖子文案" notebook                              │
│     ├─ 批量生成 N 篇 Deep Post（每篇 5-8 句）               │
│     ├─ 应用 XXIP 内容母系统原则                             │
│     └─ 保存到 /tmp/deep-posts-batch-N.txt                   │
│                                                             │
│  2. 批量生成配图                                             │
│     ├─ Mac Mini + ChatGPT (DALL-E 3)                       │
│     ├─ 每篇生成 1 张 9:16 配图                               │
│     ├─ 风格：深色背景 + 金色标题 + 简约高级                  │
│     └─ 保存到 output/deep-post-cards/                       │
│                                                             │
│  3. 输出                                                    │
│     ├─ N 篇 Deep Post 文案                                  │
│     └─ N 张高质量配图 (PNG, ~400KB/张)                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 使用方法

### 方式 1：完整流程（推荐）

```bash
# 1. 生成内容
notebooklm use bd630b56-afb1-478b-aab9-9dba5a762f7d  # 帖子文案 notebook
notebooklm ask "请基于素材生成 5 篇全新的 Deep Post（第 1-5 篇）..." --new

# 重复直到生成足够数量（每次 5 篇）

# 2. 保存文案到 /tmp/deep-posts-batch-N.txt

# 3. 批量生成配图
python3 scripts/batch-generate-cards.py
```

### 方式 2：只生成配图（已有文案）

```bash
# 确保文案保存在 /tmp/deep-posts-batch-N.txt
# 格式：
# Deep Post 1: 标题
# 正文内容...
#
# Deep Post 2: 标题
# 正文内容...

python3 scripts/batch-generate-cards.py
```

## 参数配置

编辑 `scripts/batch-generate-cards.py`：

```python
# 批量数量
for i, post in enumerate(posts[:N], 1):  # N = 生成数量

# 等待时间（根据图片复杂度调整）
time.sleep(60)  # 60 秒，复杂图片可能需要更长

# 参考图
'-r', 'assets/cards/reference-match-v6.png'  # 风格参考图

# 输出目录
output_dir = Path('output/deep-post-cards')
```

## 依赖环境

### NotebookLM
- 已登录 Google 账号
- 访问 "帖子文案" notebook (bd630b56-afb1-478b-aab9-9dba5a762f7d)

### Mac Mini
- SSH 连接：`ssh mac-mini`
- SSH 隧道：端口 19222 → 9222
- Chrome debug 模式运行
- ChatGPT 已登录

### 脚本
```bash
# 确保隧道
bash skills/image-gen-workflow/scripts/ensure-tunnel.sh

# 检查连接
curl -s http://localhost:19222/json | jq '.[0].title'
```

## 性能指标

| 项目 | 时间 |
|------|------|
| 生成 5 篇内容 (NotebookLM) | ~2 分钟 |
| 生成 1 张配图 (ChatGPT) | ~60 秒 |
| 生成 35 篇内容 | ~15 分钟 |
| 生成 35 张配图 | ~35 分钟 |
| **总计 (35 篇+图)** | **~50 分钟** |

## 输出示例

```
output/deep-post-cards/
├── 01_别把存档当成学会.png          (396 KB)
├── 02_礼貌的暴政.png                (396 KB)
├── 03_穷忙的快感.png                (396 KB)
├── 04_装备党的陷阱.png              (396 KB)
└── ...
```

## 质量标准

### 内容质量（NotebookLM）
- 5-8 句话
- 有清晰观点和论证
- 适合社交媒体发布
- 应用陌生化手段（演绎/并置/转换）

### 配图质量（ChatGPT）
- 尺寸：1080 x 1920 (9:16)
- 风格：深色渐变背景
- 标题：金色/橙色高亮
- 正文：米白色
- 装饰：2-3 个抽象图标
- 整体：简约高级杂志感

## 常见问题

### ChatGPT 生成失败
- 检查 SSH 隧道：`bash skills/image-gen-workflow/scripts/ensure-tunnel.sh`
- 检查 ChatGPT 是否登录
- 增加等待时间：`time.sleep(90)`

### 图片提取失败
- 手动运行：`python3 skills/image-gen-workflow/scripts/extract-image.py`
- 查看 /tmp/generated-*.png
- 检查 Mac Mini Chrome 是否正常

### 批量中断
- 查看日志：`tail -f /tmp/batch-generate-all.log`
- 继续从中断处：修改脚本 `posts[N:]` 从第 N 篇开始

## 监控进度

```bash
# 查看日志
tail -f /tmp/batch-generate-all.log

# 查看已生成数量
ls -1 output/deep-post-cards/ | wc -l

# 查看进程
ps aux | grep batch-generate-cards
```

## 扩展建议

### 未来优化
- [ ] 自动质量评分（Claude 评分系统）
- [ ] 自动发送到飞书
- [ ] 支持更多配图风格
- [ ] 并行生成（多个 ChatGPT 账号）
- [ ] 自动保存到 Notion 数据库

### 其他应用
- Broad Post 生成
- Newsletter 生成
- 短视频脚本 + 封面图
