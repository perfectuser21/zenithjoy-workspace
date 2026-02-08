# 视频号图文 vs 视频字段分析

## 分析日期
2026-02-08

## 数据来源
- **采集器**：`/home/xx/scraper-channels-v3.js`
- **API 端点**：`POST https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_list`
- **历史数据**：`~/.platform-data/channels_1770465669769.json`（20条作品）
- **浏览器端口**：`100.97.242.124:19228`

## 核心发现

### 1. 内容类型识别

**重要发现**：当前采集器**未区分视频和图文**，所有作品都被标记为"视频"（`content_type_normalized: '视频'`）。

```javascript
// scraper-channels-v3.js:126
await dbClient.query(`
  INSERT INTO content_master (platform, title, publish_time, content_type_normalized, first_seen_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT (platform, title, publish_time) DO UPDATE SET updated_at = NOW()
`, ['channels', item.title, publishTime, '视频']);  // ← 硬编码为'视频'
```

**API 响应结构分析**：

根据采集器代码，`post_list` API 返回的每个作品对象包含：
- `desc.description`：作品描述/标题
- `desc.shortTitle[0].shortTitle`：短标题
- `createTime`：创建时间戳
- `readCount`：播放量
- `likeCount`：点赞数
- `commentCount`：评论数
- `forwardCount`：转发数
- `favCount`：收藏数

**缺少的关键字段**：
- ❌ **内容类型标识**（视频/图文）
- ❌ **时长**（视频专属）
- ❌ **图片数量**（图文专属）
- ❌ **完播率**（性能指标）
- ❌ **平均播放时长**（性能指标）
- ❌ **5秒完播率**（性能指标）

### 2. 字段清单

#### 已采集字段（来自 `post_list` API）

| 字段 | API 字段名 | 说明 | 示例值 |
|------|-----------|------|--------|
| 标题 | `desc.description` | 作品描述 | "留下你的行业。 #个人IP #流量密码" |
| 发布时间 | `createTime` | Unix 时间戳（秒） | 1770465669 |
| 播放量 | `readCount` | 浏览次数 | 167 |
| 点赞 | `likeCount` | 点赞数 | 2 |
| 评论 | `commentCount` | 评论数 | 1 |
| 分享 | `forwardCount` | 转发数 | 1 |
| 收藏 | `favCount` | 收藏数 | 2 |

#### 未采集的可能字段

基于抖音/快手/小红书的经验，视频号**可能存在**以下字段（需要登录后验证）：

**视频专属字段**：
- 时长（duration）
- 完播率（completion_rate）
- 平均播放时长（avg_play_duration）
- 5秒完播率（completion_rate_5s）
- 2秒跳出率（bounce_rate_2s）

**图文专属字段**：
- 图片数量（image_count）
- 平均浏览图片数（avg_image_view）
- 文案展开率（text_expand_rate）

**可能的共同字段**：
- 粉丝量增长（follower_gain）
- 涨粉率（follower_growth_rate）

### 3. API 架构分析

**结论**：视频号采用 **统一 API** 架构（类型 B/C）

**证据**：
1. 采集器只拦截一个 API：`post/post_list`
2. 没有分开的"图文列表"和"视频列表"API
3. 所有作品在同一个 `data.list` 数组中返回

**对比三种已知架构**：

| 平台 | 架构模式 | 特征 |
|------|---------|------|
| 抖音 | 分开 API（类型 A）| 不同端点，字段完全不同 |
| 快手 | 统一 API，字段相同（类型 B）| 单一端点，字段完全一致 |
| 小红书 | 统一 API，字段重叠（类型 C）| 单一端点，字段部分共享 |
| **视频号** | **统一 API（类型 B or C）** | **单一端点，未知字段是否相同** |

**推断**：
- 视频号更可能是**类型 C（字段重叠）**，因为图文和视频的播放/浏览行为不同
- 需要登录后查看详细数据 API 或作品详情页来确认

### 4. 区分规则（推测）

由于当前数据中**没有内容类型标识**，需要通过以下方式推断：

**方法 1：检查时长字段**
```javascript
if (item.duration && item.duration > 0) {
  // 视频
} else {
  // 图文（或直播）
}
```

**方法 2：检查图片数量字段**
```javascript
if (item.imageCount && item.imageCount > 0) {
  // 图文
} else {
  // 视频
}
```

**方法 3：检查媒体类型字段**
```javascript
if (item.mediaType === 'video') {
  // 视频
} else if (item.mediaType === 'image') {
  // 图文
}
```

**实际采用哪种方法需要登录后查看 API 响应确认。**

### 5. 完播率数据

**状态**：❌ 未确认

**分析**：
- `post_list` API **不包含**完播率等性能指标
- 参考抖音的经验，完播率通常在：
  1. 单独的性能 API（如 `/creator/data/performance`）
  2. 作品详情页（点击单个作品查看详细数据）
  3. 数据中心/统计页面（专门的分析页面）

**可能的端点**（需要登录后验证）：
- `https://channels.weixin.qq.com/platform/data/...`
- `https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/data/...`
- `https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/detail?id=...`

### 6. 登录限制

**当前状态**：❌ 浏览器端口 19228 未登录

**错误信息**：
```
当前 URL: https://channels.weixin.qq.com/login.html
页面显示: "一站式服务，让创作更简单"（扫码登录页）
```

**原因**：
- 视频号使用微信扫码登录
- 无法通过自动化脚本登录（微信安全机制）
- 需要人工扫码才能进入创作者后台

**影响**：
- 无法查看数据中心页面
- 无法确认完播率等性能指标的 API 端点
- 无法验证图文/视频的字段差异

## 采集策略建议

### 当前采集器的不足

1. **未区分内容类型**：所有作品都标记为"视频"
2. **缺少性能指标**：没有完播率、平均播放时长等关键数据
3. **单一 API 依赖**：只拦截 `post_list`，可能遗漏详细数据

### 升级建议

#### 短期改进（基于现有 API）

```javascript
// 1. 添加内容类型判断
const contentType = item.duration > 0 ? '视频' : '图文';

// 2. 尝试提取更多字段
const detailedItem = {
  title: item.desc?.description || '',
  publishTime: formatTime(item.createTime),
  contentType,  // ← 新增
  duration: item.duration || null,  // ← 新增
  imageCount: item.imageCount || null,  // ← 新增
  views: item.readCount || 0,
  likes: item.likeCount || 0,
  comments: item.commentCount || 0,
  shares: item.forwardCount || 0,
  favorites: item.favCount || 0
};
```

#### 长期改进（需要登录）

1. **拦截更多 API**：
   ```javascript
   Network.responseReceived(async (params) => {
     const url = params.response.url;

     // 作品列表
     if (url.includes('post/post_list')) {
       // 现有逻辑
     }

     // 性能数据（推测）
     if (url.includes('/data/') || url.includes('/performance')) {
       // 捕获完播率等指标
     }

     // 作品详情
     if (url.includes('post/detail')) {
       // 捕获详细字段
     }
   });
   ```

2. **导航到数据中心页面**：
   ```javascript
   // 先获取作品列表
   await Page.navigate({ url: 'https://channels.weixin.qq.com/platform/post/list' });
   await waitForAPI('post_list');

   // 再进入数据中心
   await Page.navigate({ url: 'https://channels.weixin.qq.com/platform/data/...' });
   await waitForAPI('performance_api');
   ```

3. **点击单个作品查看详情**：
   - 使用 DOM 操作点击作品卡片
   - 拦截详情页 API
   - 合并列表数据和详情数据

## 四平台对比总结

| 平台 | API 架构 | 内容类型区分 | 完播率 | 图文专属字段 | 视频专属字段 |
|------|---------|-------------|-------|-------------|-------------|
| **抖音** | 分开 API（类型 A）| 有时长/图片数 | 仅视频 | 文案展开率、平均浏览图片 | 平均播放时长、5秒完播率、2秒跳出率 |
| **快手** | 统一 API，字段相同（类型 B）| 有时长标识 | 图文和视频都有 | 无（字段完全相同）| 无（字段完全相同）|
| **小红书** | 统一 API，字段重叠（类型 C）| 字段值判断 | 仅视频 | 平均浏览图片数 | 完播率、5秒完播率、弹幕数、平均播放时长 |
| **视频号** | 统一 API（类型 B or C）| ❓ 未知（需要登录）| ❓ 未知（需要登录）| ❓ 未知 | ❓ 未知 |

### 归类推断

**最可能归类**：**类型 C（统一 API，字段部分重叠）**

**推断依据**：
1. 使用统一 API（`post_list`）✅
2. 微信生态注重内容形式多样性（视频、图文、直播），不太可能字段完全相同
3. 视频和图文的消费行为本质不同（播放 vs 浏览），性能指标必然有差异
4. 参考小红书（同样是社交+内容平台），视频号很可能也采用字段重叠模式

**待验证**：需要登录后查看详细数据 API 来最终确认。

## 下一步

### 必须完成（验收标准）

1. ✅ **基础字段清单**：已提取 7 个字段（标题、时间、播放、点赞、评论、分享、收藏）
2. ⚠️ **内容类型区分**：已分析逻辑，但需登录验证
3. ❌ **完播率数据**：未确认，需登录后查看性能 API
4. ✅ **API 架构归类**：统一 API（类型 B or C）
5. ✅ **采集策略建议**：已提供短期和长期改进方案

### 需要人工介入

由于视频号强制微信扫码登录，无法通过自动化脚本完成以下验证：

1. 登录视频号创作者平台（扫码）
2. 进入数据中心/作品管理页面
3. 查看单个作品的详细数据
4. 拦截完整的 API 响应（包含性能指标）
5. 确认视频/图文的字段差异

**推荐下一步**：
1. 人工登录视频号创作者平台
2. 运行改进版的拦截脚本（监听所有 `/data/`、`/performance`、`/detail` 等端点）
3. 手动点击几个视频和图文作品，查看详情
4. 捕获完整的 API 响应
5. 更新本文档的"未知"字段

## 相关文件

- 采集器源码：`/home/xx/scraper-channels-v3.js`
- 历史数据：`~/.platform-data/channels_*.json`
- 抖音分析：Memory 中已记录
- 快手分析：Memory 中已记录
- 小红书分析：`.tasks/xiaohongshu-fields-comparison.md`
- 跨平台对比：`/tmp/platform-fields-complete.md`（待更新）

---

## 附录：采集器代码关键片段

### 内容类型硬编码问题

```javascript
// scraper-channels-v3.js:100-109
allItems.push({
  title: title.substring(0, 200),
  publishTime,
  views: item.readCount || 0,
  likes: item.likeCount || 0,
  comments: item.commentCount || 0,
  shares: item.forwardCount || 0,
  favorites: item.favCount || 0
  // ❌ 缺少 contentType 字段
});

// scraper-channels-v3.js:126
VALUES ($1, $2, $3, $4, NOW())
`, ['channels', item.title, publishTime, '视频']);
//                                        ^^^^^
//                                        硬编码，应该动态判断
```

### API 拦截逻辑

```javascript
// scraper-channels-v3.js:33-42
Network.responseReceived(async (params) => {
  const url = params.response.url;
  if (url.includes('post/post_list') || url.includes('post_list')) {
    try {
      const { body } = await Network.getResponseBody({ requestId: params.requestId });
      console.error('[视频号] 捕获 post_list API');
      postListData = body;
    } catch (e) {}
  }
  // ❌ 只拦截一个 API，可能遗漏性能数据
});
```

### 建议改进

```javascript
// 改进 1：动态判断内容类型
const contentType = (item.duration && item.duration > 0) ? '视频' : '图文';

// 改进 2：拦截更多 API
Network.responseReceived(async (params) => {
  const url = params.response.url;

  // 作品列表
  if (url.includes('post/post_list')) {
    capturePostList(params);
  }

  // 性能数据（推测）
  if (url.includes('/data/performance') || url.includes('/stat')) {
    capturePerformance(params);
  }

  // 作品详情
  if (url.includes('/post/detail')) {
    captureDetail(params);
  }
});

// 改进 3：提取更多字段
allItems.push({
  title,
  publishTime,
  contentType,  // 新增
  duration: item.duration || null,  // 新增
  imageCount: item.imageCount || null,  // 新增
  views: item.readCount || 0,
  likes: item.likeCount || 0,
  comments: item.commentCount || 0,
  shares: item.forwardCount || 0,
  favorites: item.favCount || 0,
  // 以下字段需要从详细 API 获取
  completionRate: item.completionRate || null,  // 新增（需要验证）
  avgPlayDuration: item.avgPlayDuration || null,  // 新增（需要验证）
});
```

---

**文档版本**：1.0.0
**作者**：Claude (Sonnet 4.5)
**最后更新**：2026-02-08
**状态**：部分完成（受登录限制）
