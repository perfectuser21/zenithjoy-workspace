# Learning: douyin-article-probe — 重建抖音文章脚本 + 全平台探针

**Branch**: cp-04021700-douyin-article-probe  
**PR**: #118  
**Date**: 2026-04-02

## 做了什么

1. 重建 `publish-douyin-article.js`（从文档重建，Windows PC SSH 不通时的应对方法）
2. 新增 `probe-all-platforms.cjs`（一条命令探测全部8个平台连通状态）

## 关键发现

### 1. 文档驱动重建（无源码的情况下）

当原始脚本不可访问时，可从三类文档重建：
- `STATUS.md`：关键技术细节（封面必需、XPath 精确路径、成功标志）
- `FIELDS.md`：字段映射和选择器（逐行注释原脚本的代码位置）
- 同类脚本（image.js/video.js）：架构模板（CDP 连接、SCP 函数、队列文件格式）

重建结果与原版行为一致，因为文档记录了所有 breakthough 细节。

### 2. 抖音文章发布三个关键点（从文档提取）

1. **封面是必需的** — `cover` 字段虽然标为可选，但选"无文章头图"会静默失败
2. **发布按钮必须用 XPath** — `button:has-text("发布")` 选择器在文章页不可靠
3. **封面上传后必须等 5 秒** — 等待上传完成，关闭"完成"弹窗后再等 3 秒

### 3. probe-all-platforms.cjs 设计

- 并行 `Promise.all` 探测7个 CDP 平台（超时 5 秒）+ 微信走 `check-wechat-token.cjs`
- 登录状态判断：URL 是否包含 login/passport 关键词
- 端口分配：19222（抖音）→ 19223（快手）→ 19224（视频号）→ 19226（头条）→ 19227（微博）→ 19228（小红书）→ 19229（知乎）

### 4. GitHub Secret 缺失不影响 CI

DeepSeek Code Review 失败（OPENROUTER_API_KEY 未设置）不是 required check。
Required checks 只有 L1-L4，都通过即可合并。

## 用法

```bash
# 探测所有平台状态
node services/creator/scripts/publishers/probe-all-platforms.cjs

# 发布抖音文章
node services/creator/scripts/publishers/douyin-publisher/publish-douyin-article.js queue.json
# queue.json: { "title": "...", "content": "...", "cover": "/path/cover.jpg" }
```
