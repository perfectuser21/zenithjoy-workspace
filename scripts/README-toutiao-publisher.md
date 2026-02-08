# 今日头条发布脚本部署说明

## 文件位置

**源文件**：`scripts/notion-toutiao-publisher.js`（本仓库）
**部署位置**：`/home/xx/notion_toutiao_publisher.js`（美国 VPS）

## 部署方法

修复完成后，将脚本复制到部署位置：

```bash
cp scripts/notion-toutiao-publisher.js /home/xx/notion_toutiao_publisher.js
chmod +x /home/xx/notion_toutiao_publisher.js
```

## N8N Workflow 配置

N8N workflow (`/workflows/n8n/media/flow-notion到头条发布.json`) 通过 SSH 调用脚本：

```javascript
echo '{{ $json.publishData }}' | node /home/xx/notion_toutiao_publisher.js
```

**不需要修改 N8N workflow**，只需更新脚本文件即可。

## 修复内容

### 问题根因

原脚本使用错误的发布流程，直接点击"预览并发布"后寻找"确定"或"发布"按钮，但实际上：
1. 点击"预览并发布"只是进入设置页面
2. 需要先点击"预览"按钮
3. 预览后会出现新的"发布"按钮

### 正确流程

1. 填写标题和内容 ✅
2. 点击"预览并发布" → 进入设置页面
3. 选择"无封面" → 避免图片上传要求
4. 点击"预览" → 打开预览窗口
5. 点击"发布" → 完成发布

### 技术要点

- CDP 超时设置：30秒（`setTimeout(..., 30000)`）
- 等待时间优化：
  - 进入设置：3s
  - 选择封面：1.5s
  - 打开预览：2.5s
  - 发布监控：8s
- 保留云端同步弹窗处理（来自 commit 5064c1a）
- 使用 `Object.getOwnPropertyDescriptor` 绕过 React 受控输入

## 测试方法

```bash
# 准备测试数据
cat > /tmp/test-publish.json << 'EOF'
{
  "title": "测试文章标题",
  "content": "这是测试内容，需要足够长度才能发布。测试内容测试内容测试内容测试内容测试内容测试内容测试内容测试内容测试内容测试内容测试内容测试内容测试内容。"
}
EOF

# 执行测试
cat /tmp/test-publish.json | node /home/xx/notion_toutiao_publisher.js

# 预期输出
# [头条] 开始发布...
# [头条] 填写内容: 标题=测试文章标题...
# ...
# [头条] ✅ 发布成功
# {"success":true,"url":"..."}
```

## 故障排查

### 脚本未找到发布页面

确保 Windows Chrome 已打开今日头条发布页面：
```
https://mp.toutiao.com/profile_v4/graphic/publish
```

### CDP 连接失败

检查 CDP 端口是否可访问：
```bash
curl http://100.97.242.124:19225/json
```

### 发布按钮未找到

可能是页面加载时间不足，尝试增加等待时间。

## 相关 Commit

- `5064c1a`: 修复云端同步弹窗处理
- `1de33a0`: 清理垃圾文件（误删了原有的发布脚本）
