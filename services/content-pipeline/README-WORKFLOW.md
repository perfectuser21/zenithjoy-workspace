# Content Creator - 完整工作流

## ✅ 已完成

### 1. 完整工作流测试（Bash）
- ✅ 8 个步骤全部测试通过
- ✅ Content ID 生成
- ✅ 文案生成（模拟）
- ✅ 配图生成（使用已有图片）
- ✅ NAS 保存（创建、上传文案、上传配图、更新状态）
- ✅ 验证成功

**测试脚本**: `/tmp/complete-workflow-test.sh`

### 2. N8N Workflow
- ✅ workflow JSON 已创建
- ✅ 修复了 Content ID 生成问题
- ✅ 11 个节点的完整流程

**文件**: 
- `n8n-content-creator-workflow-v2.json`（推荐使用）
- `n8n-content-creator-workflow.json`（v1）

### 3. NAS 集成
- ✅ NAS 连接正常 (100.110.241.76)
- ✅ nas-content-manager.sh 所有功能测试通过
- ✅ 已有 164+ 个内容

## 📋 N8N Workflow 导入方法

### 方式 1：Web UI 手动导入（推荐）

1. 访问 N8N: http://localhost:5679
2. 点击左上角 **"+"** → **Import from File**
3. 选择文件: `/home/xx/perfect21/zenithjoy/creator/n8n-content-creator-workflow-v2.json`
4. 点击 **Import**
5. 点击右上角 **Active** 开关激活
6. 保存

### 方式 2：复制 JSON 导入

```bash
# 复制 workflow JSON
cat /home/xx/perfect21/zenithjoy/creator/n8n-content-creator-workflow-v2.json | pbcopy

# 或查看内容
cat /home/xx/perfect21/zenithjoy/creator/n8n-content-creator-workflow-v2.json
```

然后在 N8N UI:
1. 点击 **"+"** → **Import from URL or Clipboard**
2. 粘贴 JSON
3. 保存并激活

## 🚀 使用方法

### 1. 手动测试（推荐先用这个）

```bash
# 运行完整工作流测试脚本
bash /tmp/complete-workflow-test.sh
```

### 2. 调用 N8N Workflow

```bash
# 导入并激活 workflow 后
curl -X POST http://localhost:5679/webhook/content-creator \
  -H "Content-Type: application/json" \
  -d '{
    "type": "deep-post",
    "title": "AI 时代的个人竞争力"
  }'
```

## 📊 Workflow 节点

1. **Webhook 触发** - 接收 POST 请求
2. **生成 Content ID** - 时间戳格式 (YYYYMMDD-HHMMSS)
3. **生成文案** - 模拟 NotebookLM（需要替换为真实调用）
4. **生成配图** - 使用已有图片（生产环境替换为 ChatGPT）
5. **检查配图成功** - 判断是否继续
6. **创建 NAS 内容** - nas-content-manager.sh create
7. **上传文案** - nas-content-manager.sh update-text
8. **上传配图** - nas-content-manager.sh upload-image
9. **更新状态** - nas-content-manager.sh update-status
10. **返回成功** - JSON 响应
11. **返回失败** - 错误响应

## 🔧 待优化

- [ ] 集成真实的 NotebookLM API（节点 3）
- [ ] 集成真实的 ChatGPT 生成（节点 4）
- [ ] 添加质量评分（Claude 评分 ≥8 才保存）
- [ ] 添加错误重试机制
- [ ] 添加通知（飞书/邮件）
- [ ] 支持批量生成

## 📝 NAS 内容结构

```
/volume1/workspace/vault/zenithjoy-creator/content/
└── <content_id>/              # 例如: 20260213-171220
    ├── manifest.json          # 元数据
    ├── text/
    │   └── text_v1.md        # 文案
    ├── images/
    │   └── cover.png         # 配图
    ├── videos/
    ├── exports/
    └── logs/
```

## 🎯 测试结果示例

Content ID: 20260213-171220
状态: ready
NAS 路径: /volume1/workspace/vault/zenithjoy-creator/content/20260213-171220

## 相关工具

- 完整测试脚本: `/tmp/complete-workflow-test.sh`
- NAS 管理工具: `/home/xx/perfect21/infrastructure/scripts/nas-content-manager.sh`
- N8N: http://localhost:5679
- NAS: 100.110.241.76 (Tailscale)
