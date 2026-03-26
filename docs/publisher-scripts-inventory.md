# 全平台发布脚本清单

> 生成日期：2026-03-26
> 来源：zenithjoy 仓库自动扫描
> 覆盖平台：8 个（抖音 / 快手 / 小红书 / 头条 / 微博 / 视频号 / 知乎 / 公众号）

---

## 目录结构总览

```
zenithjoy/
├── services/creator/scripts/publishers/    ← 主发布脚本（按平台分目录）
│   ├── douyin-publisher/
│   ├── kuaishou-publisher/
│   ├── xiaohongshu-publisher/
│   ├── toutiao-publisher/
│   ├── weibo-publisher/
│   ├── shipinhao-publisher/
│   ├── zhihu-publisher/
│   └── wechat-publisher/
├── scripts/                                ← 顶层编排脚本（NAS 调度 / content-id 发布）
└── workflows/
    ├── n8n/media/                          ← n8n 工作流 JSON 配置
    └── platform-data/workflows/publisher/ ← 批量发布编排脚本
```

**共享依赖（`services/creator/scripts/publishers/package.json`）**：

| 依赖 | 版本 | 用途 |
|------|------|------|
| `playwright` | ^1.40.0 | CDP 连接 Windows Chrome 浏览器 |
| `ws` | ^8.16.0 | WebSocket 通信 |

---

## 平台详细清单

### 1. 抖音

**目录**：`services/creator/scripts/publishers/douyin-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `douyin-publisher/publish-douyin-image.js` | 图文/多图发布 | CDP + SCP 传图到 Windows | playwright, child_process | ❌ 无测试 |
| `douyin-publisher/publish-douyin-video.js` | 视频发布 | CDP + SCP 传视频到 Windows | playwright, child_process | ❌ 无测试 |

**技术方案说明**：Playwright CDP 连接 Windows Chrome → SCP 通过 xian-mac 跳板机传输文件到 Windows → UI 自动化操作抖音创作平台。

**参考文档**：
- `douyin-publisher/REQUIREMENTS.md` — 环境需求
- `douyin-publisher/FIELDS.md` — 内容字段说明
- `douyin-publisher/STATUS.md` — 功能状态

**CDP 端口**：未独立分配（使用 Playwright 默认）

---

### 2. 快手

**目录**：`services/creator/scripts/publishers/kuaishou-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `kuaishou-publisher/publish-kuaishou-api.cjs` | 图文发布（推荐方案） | CDP 提取 Cookie → HTTP API 直接调用 | ws, http, cdp-client.cjs | ✅ `__tests__/publish-kuaishou-api.test.cjs` |
| `kuaishou-publisher/publish-kuaishou-image.cjs` | 图文发布（旧 UI 方案） | CDP 控制浏览器 UI + SCP 传图 | playwright, child_process | ❌ 无测试 |
| `kuaishou-publisher/publish-kuaishou-video.cjs` | 视频发布 | Playwright CDP + 直接上传 | playwright | ❌ 无测试 |
| `kuaishou-publisher/check-kuaishou-session.cjs` | 会话状态检查 | CDP 验证 Cookie 有效性 | ws | ❌ 无测试 |
| `kuaishou-publisher/batch-publish-kuaishou.sh` | 批量发布 | 扫描 `~/.kuaishou-queue/{date}/` | bash | ❌ 无测试 |
| `kuaishou-publisher/utils.cjs` | 工具函数 | 纯函数（图片扫描等） | fs, path | ✅ `__tests__/utils.test.cjs` |

**技术方案说明**：
- **新 API 方案**（推荐）：CDP 连接 Windows Chrome 提取 Cookie → 本机 HTTP 直接调用快手创作者中心 API，稳定性高
- **旧 UI 方案**：CDP 控制浏览器 UI 点击，受页面改版影响

**CDP 端口**：19223

---

### 3. 小红书

**目录**：`services/creator/scripts/publishers/xiaohongshu-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `xiaohongshu-publisher/publish-xiaohongshu-image.cjs` | 图文发布 | CDP UI 自动化（Input.dispatchMouseEvent 绕过 Vue 上传限制） | ws, http, cdp-client.cjs | ✅ `__tests__/publish-xiaohongshu-image.test.cjs` |
| `xiaohongshu-publisher/publish-xiaohongshu-article.cjs` | 长文发布 | CDP UI 自动化 + HTML 转纯文本 | ws, cdp-client.cjs | ❌ 无测试 |
| `xiaohongshu-publisher/publish-xiaohongshu-video.cjs` | 视频发布 | CDP UI 自动化 + SCP 传输 | ws, child_process, cdp-client.cjs | ❌ 无测试 |
| `xiaohongshu-publisher/batch-publish-xiaohongshu.sh` | 批量发布 | 扫描 `~/.xiaohongshu-queue/{date}/` | bash | ❌ 无测试 |
| `xiaohongshu-publisher/utils.cjs` | 工具函数 | 纯函数 | fs, path | ✅ `__tests__/utils.test.cjs` |

**技术方案说明**：CDP 连接 Windows Chrome（19224 端口）→ UI 自动化操作小红书创作平台。图片上传使用 `Input.dispatchMouseEvent` 而非标准 `DOM.setFileInputFiles`（原因：小红书使用 Vue 自定义上传组件，标准方案无法触发）。

**CDP 端口**：19224

---

### 4. 头条

**目录**：`services/creator/scripts/publishers/toutiao-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `toutiao-publisher/publish-toutiao-image.cjs` | 微头条图文发布 | CDP + ProseMirror 编辑器自动化 | ws, http, child_process | ❌ 无测试 |
| `toutiao-publisher/publish-toutiao-post.cjs` | 图文发布（读 JSON 配置） | CDP UI 自动化完整发布流程 | ws, fs | ❌ 无测试 |
| `toutiao-publisher/publish-toutiao-article.cjs` | 通用发布（图文/视频） | WebSocket + HTTP API | ws, http | ❌ 无测试 |
| `toutiao-publisher/publish-toutiao-video.cjs` | 视频发布 | SCP 传输 + CDP 上传 | ws, child_process | ❌ 无测试 |

**技术方案说明**：CDP 连接 Windows Chrome（19226 端口）。使用 WebSocket + HTTP 混合方案，需填写 ProseMirror 富文本编辑器内容。

**CDP 端口**：19226

---

### 5. 微博

**目录**：`services/creator/scripts/publishers/weibo-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `weibo-publisher/publish-weibo-api.cjs` | 图文发布（推荐方案） | CDP 提取 Cookie → HTTP API 直接上传+发布 | http, fs, cdp-client.cjs | ✅ `__tests__/publish-weibo-api.test.cjs` |
| `weibo-publisher/publish-weibo-image.cjs` | 图文发布（旧 UI 方案） | CDP 控制浏览器 + 验证码自动处理 | ws, http, cdp-client.cjs | ✅ `__tests__/publish-weibo-image.test.cjs` |
| `weibo-publisher/publish-weibo-video.cjs` | 视频发布 | SCP 传输 + CDP 上传 | ws, child_process | ❌ 无测试 |
| `weibo-publisher/batch-publish-weibo.sh` | 批量发布 | 扫描 `~/.weibo-queue/{date}/` | bash | ❌ 无测试 |
| `weibo-publisher/cdp-client.cjs` | **共享工具类** | CDP WebSocket 通信封装（被其他平台引用） | ws | ✅ `__tests__/cdp-client.test.cjs` |
| `weibo-publisher/utils.cjs` | 工具函数 | 图片扫描、Cookie 解析等纯函数 | fs, path | ✅ `__tests__/utils.test.cjs` |

**技术方案说明**：
- **新 API 方案**（推荐）：CDP 提取 Cookie → HTTP 直接调用微博接口上传图片和发布，稳定快速
- **旧 UI 方案**：CDP 控制浏览器 UI，包含内置验证码自动处理逻辑

**重要**：`cdp-client.cjs` 是跨平台共享工具类，被 xiaohongshu/weibo/zhihu 等平台脚本引用（通过 `require('../weibo-publisher/cdp-client.cjs')`）。

**CDP 端口**：19225

---

### 6. 视频号

**目录**：`services/creator/scripts/publishers/shipinhao-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `shipinhao-publisher/publish-shipinhao-image.cjs` | 图文发布 | CDP 连接微信频道创作平台 | playwright, fs, child_process | ❌ 无测试 |
| `shipinhao-publisher/publish-shipinhao-video.cjs` | 视频发布 | CDP 连接 + 上传视频 | playwright, fs, child_process | ❌ 无测试 |

**技术方案说明**：CDP 连接 Windows Chrome（19228 端口）→ 操作 `https://channels.weixin.qq.com/platform/post/` 微信频道创作平台。

**CDP 端口**：19228

---

### 7. 知乎

**目录**：`services/creator/scripts/publishers/zhihu-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `zhihu-publisher/publish-zhihu-api.cjs` | 文章发布（推荐方案） | CDP 连接 → in-browser fetch 调用知乎内部 API | ws, cdp-client.cjs | ✅ `__tests__/publish-zhihu-api.test.cjs` |
| `zhihu-publisher/publish-zhihu-article.cjs` | 文章发布（旧 UI 方案） | CDP UI 自动化（填标题/正文/封面/发布） | ws, cdp-client.cjs | ✅ `__tests__/publish-zhihu-article.test.cjs` |
| `zhihu-publisher/publish-zhihu-idea.cjs` | 想法发布 | CDP 连接，发布轻量内容 | ws, child_process | ❌ 无测试 |
| `zhihu-publisher/publish-zhihu-video.cjs` | 视频发布 | CDP 连接上传视频 | ws, child_process | ❌ 无测试 |
| `zhihu-publisher/batch-publish-zhihu.sh` | 批量发布 | 扫描 `~/.zhihu-queue/{date}/`，支持环境变量 `ZHIHU_MODE=api/ui` | bash | ❌ 无测试 |
| `zhihu-publisher/publish-zhihu-api.cjs`（工具） | API 工具函数 | 知乎接口封装 | ws | ✅ `__tests__/publish-zhihu-api.test.cjs` |

**技术方案说明**：
- **新 API 方案**（推荐）：CDP 连接 Windows Chrome → 在浏览器内 fetch 调用知乎内部 API（知乎 CSRF 签名复杂，无法在 Node.js 外部计算，必须借用浏览器上下文）
- **旧 UI 方案**：CDP UI 自动化，操作 `https://zhuanlan.zhihu.com/write`

**CDP 端口**：19229 / 19230

---

### 8. 公众号（微信公众号）

**目录**：`services/creator/scripts/publishers/wechat-publisher/`

| 脚本路径 | 功能 | 技术方案 | 依赖 | 测试状态 |
|---------|------|---------|------|---------|
| `wechat-publisher/publish-wechat-article.cjs` | 图文文章发布 | 微信官方 API（获取Token→上传封面→上传图片→创建草稿→提交发布） | https, http, fs | ✅ `__tests__/publish-wechat-article.test.cjs` |
| `wechat-publisher/check-wechat-token.cjs` | Token 有效性检查 | 检查凭据状态（退出码：0=有效，1=无效，2=缺失） | https | ❌ 无测试 |
| `wechat-publisher/batch-publish-wechat.sh` | 批量发布 | 扫描 `~/.wechat-queue/{date}/` | bash | ❌ 无测试 |

**技术方案说明**：**唯一使用微信官方 REST API 的平台**，不依赖 CDP 或浏览器自动化。发布流程：
1. `GET https://api.weixin.qq.com/cgi-bin/token` — 获取 Access Token
2. `POST https://api.weixin.qq.com/cgi-bin/material/add_material` — 上传封面图
3. `POST https://api.weixin.qq.com/cgi-bin/media/uploadimg` — 上传正文内嵌图
4. `POST https://api.weixin.qq.com/cgi-bin/draft/add` — 创建草稿
5. `POST https://api.weixin.qq.com/cgi-bin/freepublish/submit` — 提交发布

**凭据**：`~/.credentials/wechat.env`（APPID、APPSECRET）
**Token 缓存**：`/tmp/wechat_token.json`

**CDP 端口**：无（纯 API 调用）

---

## 测试覆盖汇总

| 平台 | 有测试 | 测试文件 | 测试框架 |
|------|:---:|---------|--------|
| 抖音 | ❌ | — | — |
| 快手 | ✅ | `publish-kuaishou-api.test.cjs`, `utils.test.cjs` | Node.js 内置 `node:test` |
| 小红书 | ✅ | `publish-xiaohongshu-image.test.cjs`, `utils.test.cjs` | Node.js 内置 `node:test` |
| 头条 | ❌ | — | — |
| 微博 | ✅ | `publish-weibo-api.test.cjs`, `publish-weibo-image.test.cjs`, `cdp-client.test.cjs`, `utils.test.cjs` | Node.js 内置 `node:test` |
| 视频号 | ❌ | — | — |
| 知乎 | ✅ | `publish-zhihu-api.test.cjs`, `publish-zhihu-article.test.cjs` | Node.js 内置 `node:test` |
| 公众号 | ✅ | `publish-wechat-article.test.cjs` | Node.js 内置 `node:test` |

**无测试平台**：抖音、头条、视频号（共 3 个）

---

## CDP 端口分配

| 端口 | 平台 | 运行环境 |
|------|------|---------|
| 19223 | 快手 | Windows Chrome |
| 19224 | 小红书 | Windows Chrome |
| 19225 | 微博 | Windows Chrome |
| 19226 | 头条 | Windows Chrome |
| 19228 | 视频号 | Windows Chrome |
| 19229 | 知乎（主） | Windows Chrome |
| 19230 | 知乎（备） | Windows Chrome |

**Windows 远程访问**：
- Windows IP：`100.97.242.124`（Tailscale）
- Windows 用户：`xuxia`
- 跳板机：`xian-mac`

---

## n8n 工作流发布配置

**工作流文件位置**：`workflows/n8n/media/`

### flow-内容发布.json

| 节点类型 | 节点名称 | 功能 |
|---------|---------|------|
| Webhook | Webhook | 接收发布请求 |
| Code | 准备 | 解析请求参数 |
| If | 是否跳过 | 判断是否跳过发布 |
| **SSH** | **SSH发布** | **远程执行：`NODE_PATH=/home/xx/node_modules node /home/xx/vps_publisher.js {{ $json.taskId }} {{ $json.platform }}`** |
| Code | 解析并构建通知 | 解析执行结果 |
| HttpRequest | 飞书通知 | 发送飞书通知 |

**说明**：通过 SSH 连接 VPS，调用 `vps_publisher.js` 统一入口脚本，传入 `taskId` 和 `platform` 参数。

### flow-notion到头条发布.json

| 节点类型 | 节点名称 | 功能 |
|---------|---------|------|
| ScheduleTrigger | 定时触发 | 定时轮询 Notion |
| HttpRequest | 查询待发布 | 查询 Notion 数据库中待发布页面 |
| Code | 解析页面列表 | 提取 Notion pageId 列表 |
| HttpRequest | 获取页面内容 | 获取 Notion 页面内容 |
| Code | 提取内容 | 提取标题、正文、图片 |
| **SSH** | **发布到头条** | **远程执行：`echo '{{ $json.publishData }}' \| node /home/xx/notion_toutiao_publisher.js`** |
| HttpRequest | 更新Notion状态 | 发布成功后更新 Notion 页面状态 |
| HttpRequest | 飞书通知 | 发送成功/失败通知 |

---

## 顶层编排脚本

**位置**：`scripts/`

| 脚本 | 功能 | 依赖 |
|------|------|------|
| `scripts/publish-by-content-id.sh` | 通过 content-id 发布（works 表 → NAS 读内容 → 平台发布 → publish_logs） | bash, curl（Brain API） |
| `scripts/auto-publish-complete.cjs` | 完整自动发布流程编排 | Node.js |
| `scripts/nas-fetch-content.sh` | 从 NAS 拉取发布内容 | bash, scp |
| `scripts/toutiao-publish-universal.cjs` | 头条通用发布（遗留脚本） | Node.js, ws |
| `scripts/publish-weitoutiao.cjs` | 微头条发布（遗留脚本） | Node.js, ws |
| `scripts/notion-toutiao-publisher.js` | Notion → 头条发布桥接（被 n8n 调用） | Node.js |

---

## 工作流层编排脚本

**位置**：`workflows/platform-data/workflows/publisher/scripts/`

| 脚本 | 功能 |
|------|------|
| `batch-publish.sh` | 批量发布主脚本（跨平台） |
| `publish-kuaishou.cjs` | 快手发布编排 |
| `publish-weibo.cjs` | 微博发布编排 |
| `publish-post.cjs` | 图文通用发布编排 |
| `publish-video.cjs` | 视频通用发布编排 |
| `publish-micro.cjs` | 微内容发布编排 |

---

## API 数据库集成

**文件**：`apps/api/src/services/publish.service.ts`

发布日志持久化到 PostgreSQL：

| 方法 | 功能 |
|------|------|
| `getPublishLogsByWorkId(workId)` | 查询指定作品的所有平台发布记录 |
| `createPublishLog(data)` | 创建新发布记录 |
| `updatePublishLog(id, data)` | 更新发布状态（success/failed） |

**数据库表**：`zenithjoy.publish_logs`

| 字段 | 说明 |
|------|------|
| `work_id` | 关联作品 ID |
| `platform` | 目标平台（douyin/kuaishou/等） |
| `platform_post_id` | 平台返回的帖子 ID |
| `status` | 发布状态（pending/success/failed） |
| `response` | 平台响应原始数据 |
| `error_message` | 失败错误信息 |

---

## 技术架构模式总结

### 两种主要方案对比

| 方案 | 适用平台 | 优势 | 劣势 |
|------|---------|------|------|
| **新 API 方案** | 快手、微博、知乎 | 稳定快速，不受 UI 变化影响 | 需要逆向平台内部 API |
| **旧 UI 自动化** | 抖音、快手、小红书、头条、微博、知乎、视频号 | 通用，无需了解内部 API | 受页面改版影响，脆弱 |
| **官方 REST API** | 公众号 | 官方支持，最稳定 | 需要 AppID/Secret 凭据管理 |

### 文件传输策略

```
Mac (运行 Node.js) → [SCP via xian-mac] → Windows (Chrome CDP)
                   → [HTTP multipart]   → 平台服务器
```

### 队列目录规范

```
~/.{platform}-queue/{YYYY-MM-DD}/
├── {content-slug}/
│   ├── title.txt         # 标题
│   ├── content.txt       # 正文
│   ├── image.jpg         # 图片 (或 video.mp4)
│   └── cover.jpg         # 封面
└── done.txt              # 发布完成标记（批量脚本写入）
```
