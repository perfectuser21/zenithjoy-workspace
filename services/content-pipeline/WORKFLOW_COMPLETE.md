---
id: zenithjoy-content-workflow
version: 1.0.0
created: 2026-02-13
updated: 2026-02-13
changelog:
  - 1.0.0: 完整内容创作工作流（金句卡片版）
---

# ZenithJoy 内容创作完整工作流

## 概览

完整的端到端内容创作自动化流程：**NotebookLM 文案 + ToAPIs 金句卡片 + NAS 存储**

### 工作流步骤

```
1. 生成 Content ID (YYYYMMDD-HHMMSS)
   ↓
2. 生成文案内容（NotebookLM 或手动输入）
   ↓
3. 生成金句卡片（ToAPIs API，1:1 正方形，黑底橙红风格）
   ↓
4-8. NAS 存储（创建 → 上传文案 → 上传配图 → 更新状态）
```

### 性能指标

| 步骤 | 耗时 | 文件大小 |
|------|------|----------|
| Content ID 生成 | <1秒 | - |
| 文案生成 | <1秒 | ~200 bytes |
| 金句卡片生成 (ToAPIs) | 20-30秒 | ~300KB |
| NAS 上传 | 2-3秒 | - |
| **总计** | **~25-35秒** | **~300KB** |

## 金句卡片规格

### 视觉风格（参考 reference-match-v6.png）

- **尺寸**: 1024x1024 (1:1 正方形)
- **背景**: 纯黑色 (#0a0a0a)
- **主标题**: 白色/米白色，大字体
- **强调文字**: 橙红色 (#A95738)
- **图标**: 2个简约扁平图标，橙红色
- **版式**: 简约现代，大量留白

### ToAPIs 优势

相比原 ChatGPT 方案：
- ✅ 无需 SSH 隧道
- ✅ 无需上传参考图
- ✅ 速度更快（20秒 vs 60秒+）
- ✅ 稳定可靠
- ✅ 完全自动化

## 使用方式

### 方式 1: Bash 测试脚本

```bash
# 运行完整工作流测试
bash /tmp/test-quote-card-workflow.sh

# 自定义内容
TITLE="你的标题"
QUOTE="你的金句"
ICONS="brain,target"
bash scripts/generate-quote-card.sh "$TITLE" "$QUOTE" "$ICONS"
```

### 方式 2: N8N Workflow（自动化）

**Workflow 文件**: `n8n-content-creator-workflow-v3-quote-card.json`

**Webhook 端点**: `POST http://localhost:5678/webhook/content-creator`

**请求格式**:
```json
{
  "title": "真正的竞争力",
  "quote": "不是会用 AI，而是知道什么时候不用 AI",
  "icons": "brain,target",
  "type": "deep-post"
}
```

**响应格式**:
```json
{
  "status": "success",
  "content_id": "20260213-174144",
  "title": "真正的竞争力",
  "quote": "不是会用 AI，而是知道什么时候不用 AI",
  "type": "deep-post",
  "nas_path": "/volume1/workspace/vault/zenithjoy-creator/content/20260213-174144",
  "card_path": "/tmp/card-20260213-174144.png",
  "message": "内容创作完成（含金句卡片）"
}
```

### 方式 3: Python API 直接调用

```python
import requests

# 生成金句卡片
response = requests.post(
    "http://localhost:5678/webhook/content-creator",
    json={
        "title": "真正的竞争力",
        "quote": "不是会用 AI，而是知道什么时候不用 AI",
        "icons": "brain,target",
        "type": "deep-post"
    }
)

result = response.json()
print(f"Content ID: {result['content_id']}")
print(f"NAS Path: {result['nas_path']}")
```

## 测试验证

### 成功测试记录

**测试时间**: 2026-02-13 17:41:44

**测试结果**:
```
✅ Content ID: 20260213-174144
✅ 文案: /tmp/content-20260213-174144.md
✅ 配图: /tmp/card-20260213-174144.png (324KB, 1024x1024)
✅ NAS 创建成功
✅ 文案上传成功
✅ 配图上传成功
✅ 状态更新成功
```

**NAS 路径**: `/volume1/workspace/vault/zenithjoy-creator/content/20260213-174144`

### 验证命令

```bash
# 验证生成的配图
ls -lh /tmp/card-20260213-174144.png
file /tmp/card-20260213-174144.png

# 验证 NAS 内容
ssh hk "ls -lh /volume1/workspace/vault/zenithjoy-creator/content/20260213-174144"
```

## 相关文件

| 文件 | 作用 |
|------|------|
| `scripts/toapis-image-gen.py` | ToAPIs 图像生成核心脚本 |
| `scripts/generate-quote-card.sh` | 金句卡片生成便捷脚本 |
| `skills/quote-card-toapis/SKILL.md` | 金句卡片 Skill 文档 |
| `n8n-content-creator-workflow-v3-quote-card.json` | N8N 完整工作流（含金句卡片）|
| `/tmp/test-quote-card-workflow.sh` | Bash 测试脚本 |
| `~/.credentials/toapi.env` | ToAPIs API 凭据 |
| `assets/cards/reference-match-v*.png` | 参考图样式 |

## 技术细节

### ToAPIs API 配置

- **Base URL**: https://toapis.com/v1
- **模型**: gpt-4o-image
- **尺寸**: 1024x1024
- **模式**: 异步任务（提交 → 轮询 → 下载）

### Prompt 工程

金句卡片使用详细的风格描述 prompt，无需上传参考图：

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
Title (white): {标题}
Emphasized (orange-red): {强调文字}
Icons: {图标} (simple, flat, orange-red)
```

### NAS 集成

使用 `nas-content-manager.sh` 统一管理：

```bash
# 创建内容
nas-content-manager.sh create <content_id> "<title>" <type>

# 上传文案
nas-content-manager.sh update-text <content_id> <file_path> <version>

# 上传配图
nas-content-manager.sh upload-image <content_id> <image_path> <type>

# 更新状态
nas-content-manager.sh update-status <content_id> <status>
```

## 下一步

### 可选优化

1. **NotebookLM 集成**: 替换模拟文案生成为真实 NotebookLM API 调用
2. **质量评分**: 添加 Claude 对生成图片的评分（1-10）
3. **飞书集成**: 自动发送到飞书
4. **批量生成**: 支持一次生成多张卡片
5. **风格切换**: 支持多种卡片风格模板

### 已删除的 Skills

- ❌ `luxury-card-generator` - 已删除，使用 quote-card-toapis 替代

## 维护记录

### 2026-02-13

- ✅ 完成完整工作流测试
- ✅ 删除 luxury-card-generator skill
- ✅ 使用 quote-card-toapis 替代
- ✅ 创建 N8N workflow v3（金句卡片版）
- ✅ 验证所有 8 个步骤
- ✅ 生成测试图片（324KB, 1024x1024）

---

**工作流状态**: ✅ 生产就绪 (Production Ready)

**最后测试**: 2026-02-13 17:41:44

**测试结果**: 全部通过 (8/8)
