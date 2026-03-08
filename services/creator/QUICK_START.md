---
id: zenithjoy-quick-start
version: 1.0.0
created: 2026-02-13
---

# ZenithJoy Creator - 快速开始

## 🚀 30秒快速生成金句卡片

### 最简单的方式

```bash
bash scripts/generate-quote-card.sh "你的标题" "你的金句"
```

**示例**:
```bash
bash scripts/generate-quote-card.sh \
  "真正的竞争力" \
  "不是会用 AI，而是知道什么时候不用 AI"
```

**输出**: `/home/xx/perfect21/zenithjoy/creator/output/toapis-cards/card-YYYYMMDD-HHMMSS.png`

---

## 📋 完整工作流（含 NAS 存储）

### 运行测试脚本

```bash
bash /tmp/test-quote-card-workflow.sh
```

**包含步骤**:
1. ✅ 生成 Content ID
2. ✅ 创建文案
3. ✅ 生成金句卡片（ToAPIs）
4. ✅ 保存到 NAS

**耗时**: ~30秒

---

## 🔧 自定义内容

### 通过脚本变量

```bash
#!/bin/bash
TITLE="你的标题"
QUOTE="你的金句"
ICONS="fist,lightbulb"  # 可选图标

python3 scripts/toapis-image-gen.py \
  "Create a 1:1 square social media quote card in this exact style:

  STYLE REFERENCE:
  - Pure black background (#0a0a0a)
  - Large white/off-white title text at top
  - Orange-red (#A95738) emphasized text below
  - 2 simple flat minimalist icons in orange-red

  CONTENT:
  Title (white): $TITLE
  Emphasized (orange-red): $QUOTE
  Icons: $ICONS" \
  -s 1024x1024 \
  -o "/tmp/my-card.png"
```

---

## 🌐 通过 N8N Webhook

### 发送请求

```bash
curl -X POST http://localhost:5678/webhook/content-creator \
  -H "Content-Type: application/json" \
  -d '{
    "title": "真正的竞争力",
    "quote": "不是会用 AI，而是知道什么时候不用 AI",
    "icons": "brain,target",
    "type": "deep-post"
  }'
```

### 响应示例

```json
{
  "status": "success",
  "content_id": "20260213-174144",
  "nas_path": "/volume1/workspace/vault/zenithjoy-creator/content/20260213-174144",
  "card_path": "/tmp/card-20260213-174144.png"
}
```

---

## 📊 常用图标组合

| 主题 | 图标 |
|------|------|
| 思考/策略 | `brain,target` |
| 行动/力量 | `fist,lightning` |
| 学习/成长 | `book,rocket` |
| 创意/启发 | `lightbulb,star` |
| 工具/技术 | `wrench,gear` |

---

## 🎨 卡片风格

### 当前风格（Quote Card）

- **尺寸**: 1024x1024 (1:1 正方形)
- **背景**: 纯黑色 (#0a0a0a)
- **标题**: 白色，大字体
- **强调**: 橙红色 (#A95738)
- **图标**: 2个，橙红色，简约扁平

### 参考图

查看示例: `/home/xx/perfect21/zenithjoy/creator/assets/cards/reference-match-v6.png`

---

## 📁 输出文件位置

| 文件类型 | 路径 |
|----------|------|
| **本地卡片** | `output/toapis-cards/card-*.png` |
| **临时文件** | `/tmp/card-*.png` |
| **NAS 存储** | `/volume1/workspace/vault/zenithjoy-creator/content/<content_id>/` |

---

## 🔍 验证生成结果

### 查看本地文件

```bash
# 最新生成的卡片
ls -lht output/toapis-cards/ | head -3

# 查看具体文件
file output/toapis-cards/card-20260213-174144.png
```

### 查看 NAS 内容

```bash
# 列出所有内容
ssh hk "ls /volume1/workspace/vault/zenithjoy-creator/content/"

# 查看特定内容
ssh hk "ls -lh /volume1/workspace/vault/zenithjoy-creator/content/20260213-174144/"
```

---

## 🐛 故障排查

### ToAPIs API 失败

```bash
# 检查凭据
cat ~/.credentials/toapi.env

# 测试 API
curl -s https://toapis.com/v1/models \
  -H "Authorization: Bearer $(grep TOAPI_API_KEY ~/.credentials/toapi.env | cut -d= -f2)"
```

### NAS 连接失败

```bash
# 测试 SSH 连接
ssh hk "echo OK"

# 检查 NAS 路径
ssh hk "ls /volume1/workspace/vault/zenithjoy-creator/"
```

### 图片生成超时

- ToAPIs 通常需要 20-30 秒
- 脚本默认超时 60 次 × 3 秒 = 180 秒
- 如果超时，检查网络连接

---

## 📚 相关文档

- 完整工作流文档: `WORKFLOW_COMPLETE.md`
- 金句卡片 Skill: `skills/quote-card-toapis/SKILL.md`
- ToAPIs 脚本: `scripts/toapis-image-gen.py`
- NAS 管理: `/home/xx/perfect21/infrastructure/scripts/nas-content-manager.sh`

---

**最后更新**: 2026-02-13
**工作流状态**: ✅ 生产就绪
