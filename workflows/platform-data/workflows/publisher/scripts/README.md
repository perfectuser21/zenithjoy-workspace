---
version: 1.1.0
created: 2026-03-08
updated: 2026-03-10
changelog:
  - 1.1.0: 新增快手图文发布脚本
  - 1.0.0: 初始版本，包含今日头条三种类型 + 微博图文
---

# Publisher Scripts

自动化发布脚本集合。通过 Chrome DevTools Protocol (CDP) 控制 Windows PC 浏览器完成内容发布。

## 架构

```
Mac mini → Windows PC (100.97.242.124) → 各平台浏览器
                CDP 连接
```

## 支持平台

| 平台 | 脚本 | CDP 端口 | 内容类型 |
|------|------|----------|----------|
| **今日头条** - 微头条 | `publish-micro.cjs` | 19225 | 文字 + 图片（文件路径） |
| **今日头条** - 图文 | `publish-post.cjs` | 19225 | 标题 + 正文 + 图片（文件路径） |
| **今日头条** - 视频 | `publish-video.cjs` | 19225 | 视频文件（文件路径） |
| **微博** - 图文 | `publish-weibo.cjs` | 19227 | 文字 + 图片（base64 注入） |
| **快手** - 图文 | `publish-kuaishou.cjs` | 19223 | 文字 + 图片（base64 注入） |

## 快手发布

### 前置条件

1. Windows PC (`100.97.242.124`) Chrome 已以调试模式启动：
   ```
   chrome.exe --remote-debugging-port=19223
   ```
2. 已在 Chrome 中登录 `cp.kuaishou.com`（快手创作者平台）
3. Mac mini 安装了 `ws` 模块：`npm install ws`

### 内容格式

```json
{
  "type": "kuaishou",
  "id": "unique-id",
  "content": "快手图文文案（必填）",
  "images": [
    "/path/to/image1.jpg",
    "/path/to/image2.jpg"
  ]
}
```

- `images` 为可选，最多 9 张
- 图片路径为 Mac mini 本地路径（通过 base64 注入，无需传输到 Windows）

### 用法

```bash
# 发布内容
node publish-kuaishou.cjs --content /path/to/kuaishou.json

# 测试（纯文字）
bash test-kuaishou-publish.sh

# 测试（包含图片）
bash test-kuaishou-publish.sh --with-image
```

### 截图

发布过程的截图保存到 `/tmp/kuaishou-publish-screenshots/`，共 6 个关键节点：

| 截图 | 说明 |
|------|------|
| `01-photo-create-page.png` | 图文发布页初始状态 |
| `02-editor-loaded.png` | 编辑器加载完成 |
| `03-images-uploaded.png` | 图片已上传 |
| `04-content-filled.png` | 文案已填写 |
| `05-publish-clicked.png` | 发布按钮已点击 |
| `06-result.png` | 最终结果 |
| `error-state.png` | 错误时的页面状态 |

---

## 微博发布

### 前置条件

1. Windows PC (`100.97.242.124`) Chrome 已以调试模式启动：
   ```
   chrome.exe --remote-debugging-port=19227
   ```
2. 已在 Chrome 中登录 weibo.com
3. Mac mini 安装了 `ws` 模块：`npm install ws`

### 内容格式

```json
{
  "type": "weibo",
  "id": "unique-id",
  "content": "微博文案（必填）",
  "images": [
    "/path/to/image1.jpg",
    "/path/to/image2.jpg"
  ]
}
```

- `images` 为可选，最多 9 张
- 图片路径为 Mac mini 本地路径（通过 base64 注入，无需传输到 Windows）

### 用法

```bash
# 发布内容
node publish-weibo.cjs --content /path/to/weibo.json

# 测试（5 条纯文字）
bash test-weibo-publish.sh

# 测试（包含图片）
bash test-weibo-publish.sh --with-image
```

### 截图

发布过程的截图保存到 `/tmp/weibo-publish-screenshots/`，共 6 个关键节点：

| 截图 | 说明 |
|------|------|
| `01-initial.png` | 初始页面状态 |
| `02-compose-opened.png` | 发布框已打开 |
| `03-content-filled.png` | 文案已填写 |
| `04-images-uploaded.png` | 图片已上传 |
| `05-publish-clicked.png` | 发布按钮已点击 |
| `06-result.png` | 最终结果 |
| `error-state.png` | 错误时的页面状态 |

## 今日头条发布

今日头条图片通过 Windows 文件路径传递（`DOM.setFileInputFiles`），需要先将图片传输到 Windows PC。

```bash
# 微头条
node publish-micro.cjs --content /path/to/micro.json

# 图文
node publish-post.cjs --content /path/to/post.json

# 视频
node publish-video.cjs --content /path/to/video.json
```

## 文件传输工具

| 脚本 | 说明 |
|------|------|
| `file-transfer-client.cjs` | 文件传输客户端 |
| `file-transfer-server.cjs` | 文件传输服务端（Windows 侧） |
| `upload-to-windows.cjs` | 上传文件到 Windows |
| `ensure-files-on-windows.cjs` | 确保文件存在于 Windows |
| `check-files-windows.cjs` | 检查 Windows 文件状态 |

## 批量发布

```bash
# 按队列批量发布
bash batch-publish.sh

# 扫描待发布队列
bash scan-queue.sh

# 准备发布队列
node prepare-queue.cjs
```
