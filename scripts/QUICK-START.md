# 今日头条发布 - 快速开始

## 内容类型

今日头条有三种内容类型：

| 类型 | 状态 | 说明 |
|------|------|------|
| **文章** | ✅ 可用 | 长图文，有标题 |
| **微头条** | ⏳ 开发中 | 短内容，无标题，重点 |
| **视频** | ⏳ 开发中 | 视频内容，重点 |

## 文章发布（已可用 ✅）

### 一键发布

```bash
cd /home/xx/perfect21/zenithjoy/workspace/scripts

# 1. 创建配置文件
cat > /tmp/my-post.json << 'EOF'
{
  "type": "image",
  "title": "我的文章标题",
  "content": "文章正文内容...",
  "media": [
    "C:\\Users\\Administrator\\Desktop\\2026-02-09\\images\\图片-1.jpg",
    "C:\\Users\\Administrator\\Desktop\\2026-02-09\\images\\图片-2.jpg",
    "C:\\Users\\Administrator\\Desktop\\2026-02-09\\images\\图片-3.jpg"
  ]
}
EOF

# 2. 执行发布
node toutiao-publish-universal.cjs /tmp/my-post.json
```

## 微头条发布（开发中 ⏳）

### 配置格式（准备中）
```json
{
  "type": "micro",
  "content": "这是一条微头条内容，类似微博 #AI应用# #效率工具#",
  "images": [
    "C:\\Users\\Administrator\\Desktop\\2026-02-09\\images\\图片-1.jpg"
  ],
  "options": {
    "topic": "#AI应用#",
    "location": "北京"
  }
}
```

**特点**：
- 无标题，直接发正文
- 支持话题标签
- 支持位置信息
- 比文章发布更简单

### 文件准备

如果图片在VPS上，先上传到Windows：

```bash
# 修改 upload-to-desktop-organized.sh 中的变量
SOURCE_DIR="/path/to/images"
POST_TITLE="我的文章标题"

# 执行上传
bash upload-to-desktop-organized.sh
```

## 视频发布（开发中 ⏳）

### 状态
- 框架已准备
- 等待UI调查
- 需要手动探索视频发布界面

### 配置格式（准备中）
```json
{
  "type": "video",
  "title": "我的视频标题",
  "content": "视频描述...",
  "media": [
    "C:\\Users\\Administrator\\Desktop\\2026-02-09\\videos\\视频-1.mp4"
  ]
}
```

## 常见问题

### Q1: CDP 连接失败
```bash
# 检查 Tailscale 连接
ping 100.97.242.124

# 检查 Chrome CDP 端口
curl http://100.97.242.124:19225/json
```

### Q2: 文件上传失败
```bash
# 检查 File Receiver
curl http://100.97.242.124:3001/health

# 手动测试上传
curl -F "file=@test.jpg" http://100.97.242.124:3001/upload
```

### Q3: 发布后看不到文章
- 检查截图: `ls /tmp/publish-screenshots/`
- 手动登录头条号后台查看
- 可能在草稿箱

## 文件位置

| 文件 | 路径 |
|------|------|
| **图文发布脚本** | `/home/xx/perfect21/zenithjoy/workspace/scripts/auto-publish-complete.cjs` |
| **通用发布脚本** | `/home/xx/perfect21/zenithjoy/workspace/scripts/toutiao-publish-universal.cjs` |
| **文件上传脚本** | `/home/xx/perfect21/zenithjoy/workspace/scripts/upload-to-desktop-organized.sh` |
| **完整文档** | `/home/xx/perfect21/zenithjoy/workspace/scripts/README-toutiao-publisher.md` |
| **开发状态** | `/home/xx/perfect21/zenithjoy/workspace/scripts/TOUTIAO-STATUS.md` |

## 下一步

要完成视频发布功能，需要：

1. 在Windows浏览器中手动发布一个视频
2. 记录：
   - URL
   - 上传按钮位置
   - file input 选择器
   - 封面上传流程
3. 告诉我这些信息，我会实现自动化

## 帮助

详细文档: `README-toutiao-publisher.md`
开发状态: `TOUTIAO-STATUS.md`
