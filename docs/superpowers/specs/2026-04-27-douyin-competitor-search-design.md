# 抖音对标账号搜索 — 设计文档

**日期**：2026-04-27  
**分支**：cp-0427160618-douyin-competitor-search  
**状态**：待实现

---

## 1. 目标

新增 CLI 脚本 `search-douyin-accounts.js`，连接本机已登录的 Chrome，输入关键词，返回抖音账号搜索结果 JSON。

用法：
```bash
node search-douyin-accounts.js "AI创业" --limit 20
```

---

## 2. 架构

```
用户（终端）
    ↓ 关键词 + limit 参数
search-douyin-accounts.js
    ↓ chromium.connectOverCDP('http://localhost:19222')
已登录的本机 Chrome（端口 19222）
    ↓ page.evaluate → fetch 抖音搜索 API（携带 Cookie）
https://www.douyin.com/aweme/v1/web/discover/search/
    ↓ JSON 响应
账号列表解析 + 格式化
    ↓
终端打印 + 写 ~/.platform-data/douyin-competitor/search-<kw>-<ts>.json
```

---

## 3. 关键设计决策

### 3.1 CDP 连接方式：Playwright connectOverCDP

选用与现有 publishers 相同的 `chromium.connectOverCDP` 方式（而非 `chrome-remote-interface`），原因：
- 与 `douyin-publisher/publish-douyin-image.js` 保持一致
- `page.evaluate` 内执行 fetch，同样能携带浏览器 Cookie
- 代码更简洁，错误处理更友好

### 3.2 数据获取方式：page.evaluate API fetch（非 DOM 提取）

不解析 DOM，而是在页面上下文内 fetch 抖音内部搜索 API：

```
GET https://www.douyin.com/aweme/v1/web/discover/search/
  ?keyword={keyword}&type=1&count=10&cursor=0
  Cookie: 浏览器自动携带（已登录态）
```

- `type=1` = 用户搜索
- 支持分页 cursor 翻页
- 数据结构比 DOM 稳定

### 3.3 登录检测

连接后 fetch `https://www.douyin.com/passport/account/info/v2/` 检测登录态：
- 返回 `status_code: 0` → 已登录
- 其他 → 跳转 `https://www.douyin.com` 等待用户扫码（最多 3 分钟轮询）

### 3.4 输出字段

| 字段 | 来源 |
|------|------|
| uid | `user_info.uid` |
| username | `user_info.nickname` |
| avatar | `user_info.avatar_thumb.url_list[0]` |
| followers | `user_info.follower_count` |
| following | `user_info.following_count` |
| workCount | `user_info.aweme_count` |
| description | `user_info.signature` |
| profileUrl | `https://www.douyin.com/user/{uid}` |
| verified | `user_info.custom_verify` |

---

## 4. 文件结构

```
services/creator/scripts/publishers/douyin-publisher/
├── search-douyin-accounts.js      ← 新增（主脚本）
├── __tests__/
│   └── search-douyin-accounts.test.cjs  ← 新增（单元测试）
├── publish-douyin-image.js        （已有）
└── ...
```

---

## 5. 错误处理

| 场景 | 处理 |
|------|------|
| Chrome 未启动 / 未监听 19222 | 打印启动命令提示，exit 1 |
| 未登录 | 跳转抖音首页，等待扫码，3 分钟超时 |
| API 返回非 0 status_code | 打印错误信息，exit 1 |
| 关键词无结果 | 打印提示，输出空数组 JSON |
| 翻页 cursor 耗尽 | 自动停止，输出已采集数据 |

---

## 6. 测试策略

**测试级别：Unit Test（纯函数部分）**

脚本包含两类逻辑：
1. **纯函数**：`parseUser(rawUser)` 将 API 响应字段映射为输出格式 → 单元测试覆盖
2. **I/O 函数**：CDP 连接、fetch、文件写入 → 手动冒烟测试（脚本本身即为验证）

测试文件：`douyin-publisher/__tests__/search-douyin-accounts.test.cjs`
- `parseUser` 正确映射所有字段
- `parseUser` 对缺失字段提供默认值
- `buildSearchUrl` 正确编码关键词 + 参数

**Trivial 判定**：I/O 层 < 20 行纯包装，不单独测试；`parseUser` 和 `buildSearchUrl` 有独立逻辑，写 unit test。

---

## 7. 使用说明

```bash
# 前提：Chrome 已以调试模式启动（一次性操作）
open -a "Google Chrome" --args --remote-debugging-port=19222 --no-first-run --no-default-browser-check

# 运行搜索
cd services/creator/scripts/publishers
node douyin-publisher/search-douyin-accounts.js "AI副业" --limit 30

# 输出示例
🔍 抖音对标账号搜索
   关键词: AI副业 | 目标: 30

✅ 共采集到 28 个账号

 1. 张三  粉丝: 120万  作品: 89  主页: https://www.douyin.com/user/xxx
...

💾 结果已保存: ~/.platform-data/douyin-competitor/search-AI副业-1714224000000.json
```
