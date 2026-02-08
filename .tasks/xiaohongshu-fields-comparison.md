# 小红书图文 vs 视频字段分析报告

**分析时间**: 2026-02-08
**分析者**: Claude Code
**数据来源**: `/api/galaxy/creator/datacenter/note/base` API 拦截

---

## 一、核心发现

### 1.1 内容类型区分

**小红书采用统一 API 返回所有内容类型的数据**，不像抖音那样图文和视频有完全不同的API端点。

**区分标识**：
- API 中没有明确的 `content_type` 字段
- `note_info.type` 字段返回 "NORMAL"（待确认是否有 "VIDEO" 等其他值）
- **推断方法**：通过字段组合判断
  - 视频：`full_view_rate > 0` 或 `finish5s_rate > 0` 或 `danmaku_count > 0`
  - 图文：`avg_view_image > 0`

### 1.2 字段对比表

| 字段分类 | 字段名 | 视频 | 图文 | 说明 |
|---------|--------|:----:|:----:|------|
| **视频专属** | `full_view_rate` | ✅ | ❌ | 完播率（百分比） |
| | `finish5s_rate` | ✅ | ❌ | 5秒完播率 |
| | `exit_view2s_rate` | ✅ | ❌ | 2秒跳出率 |
| | `view_time_avg` | ✅ | ❌ | 平均播放时长（秒） |
| | `danmaku_count` | ✅ | ❌ | 弹幕数 |
| **图文专属** | `avg_view_image` | ❌ | ✅ | 平均浏览图片数 |
| **通用字段** | `view_count` | ✅ | ✅ | 浏览量 |
| | `like_count` | ✅ | ✅ | 点赞数 |
| | `comment_count` | ✅ | ✅ | 评论数 |
| | `collect_count` | ✅ | ✅ | 收藏数 |
| | `share_count` | ✅ | ✅ | 分享数 |
| | `cover_click_rate` | ✅ | ✅ | 封面点击率 |
| | `impl_count` | ✅ | ✅ | 曝光量 |
| | `rise_fans_count` | ✅ | ✅ | 涨粉数 |

### 1.3 与其他平台对比

| 平台 | 图文 vs 视频字段 | 完播率 | 图文专属字段 | API 架构 |
|------|----------------|--------|-------------|---------|
| **抖音** | **完全不同** | 仅视频 | 文案展开率、平均浏览图片 | 分开的 API |
| **快手** | **完全相同** | 图文和视频都有 | 无（与视频相同） | 统一 API |
| **小红书** | **部分重叠** | 仅视频 | 平均浏览图片 | **统一 API，字段差异** |

---

## 二、完整字段清单

### 2.1 视频字段（完整列表）

| 字段名 | 类型 | 示例值 | 说明 |
|--------|------|--------|------|
| `full_view_rate` | number | 0 | 完播率（百分比，如 45.2 表示 45.2%） |
| `finish5s_rate` | number | 0 | 5秒完播率 |
| `exit_view2s_rate` | number | 0 | 2秒跳出率 |
| `view_time_avg` | number | 3 | 平均播放时长（秒） |
| `view_time_avg_with_fans` | number | 0 | 粉丝平均播放时长 |
| `view_time_avg_with_double` | number | 3.3 | 平均播放时长（双精度） |
| `cover_click_rate` | number | 10 | 封面点击率 |
| `cover_click_rate_with_fans` | number | 0 | 粉丝封面点击率 |
| `danmaku_count` | number | 0 | 弹幕数 |
| `danmaku_rate_with_fans` | number | 0 | 粉丝弹幕率 |
| `view_count` | number | 13 | 浏览量 |
| `like_count` | number | 1 | 点赞数 |
| `comment_count` | number | 0 | 评论数 |
| `collect_count` | number | 2 | 收藏数 |
| `share_count` | number | 0 | 分享数 |
| `impl_count` | number | 70 | 曝光量 |
| `rise_fans_count` | number | 0 | 涨粉数 |
| `view_rate_with_fans` | number | 0 | 粉丝浏览率 |
| `like_rate_with_fans` | number | 0 | 粉丝点赞率 |
| `comment_rate_with_fans` | number | 0 | 粉丝评论率 |
| `collect_rate_with_fans` | number | 0 | 粉丝收藏率 |
| `share_rate_with_fans` | number | 0 | 粉丝分享率 |
| `finish5s_rate_with_fans` | number | 0 | 粉丝5秒完播率 |
| `exit_view2s_rate_with_fans` | number | 0 | 粉丝2秒跳出率 |
| `full_view_rate_with_fans` | number | 0 | 粉丝完播率 |
| `impl_count_rate_with_fans` | number | 1.4 | 粉丝曝光占比 |

### 2.2 图文字段（完整列表）

| 字段名 | 类型 | 示例值 | 说明 |
|--------|------|--------|------|
| `avg_view_image` | number | 0 | **平均浏览图片数**（图文专属） |
| `avg_view_image_with_fans` | number | 0 | 粉丝平均浏览图片数 |
| `cover_click_rate` | number | 10 | 封面点击率 |
| `cover_click_rate_with_fans` | number | 0 | 粉丝封面点击率 |
| `view_count` | number | 13 | 浏览量 |
| `like_count` | number | 1 | 点赞数 |
| `comment_count` | number | 0 | 评论数 |
| `collect_count` | number | 2 | 收藏数 |
| `share_count` | number | 0 | 分享数 |
| `impl_count` | number | 70 | 曝光量 |
| `rise_fans_count` | number | 0 | 涨粉数 |
| `view_rate_with_fans` | number | 0 | 粉丝浏览率 |
| `like_rate_with_fans` | number | 0 | 粉丝点赞率 |
| `comment_rate_with_fans` | number | 0 | 粉丝评论率 |
| `collect_rate_with_fans` | number | 0 | 粉丝收藏率 |
| `share_rate_with_fans` | number | 0 | 粉丝分享率 |
| `impl_count_rate_with_fans` | number | 1.4 | 粉丝曝光占比 |

**说明**：
- 图文作品不包含任何视频专属字段（`full_view_rate`、`finish5s_rate`、`danmaku_count` 等）
- 图文作品在 API 响应中这些字段可能为 `0` 或不存在

### 2.3 元信息字段（note_info）

| 字段名 | 类型 | 示例值 | 说明 |
|--------|------|--------|------|
| `id` | string | "698738cd00000000280207bf" | 作品ID（note_id） |
| `type` | string | "NORMAL" | 作品类型（推测：NORMAL/VIDEO/...） |
| `desc` | string | "收藏夹里的尸体!" | 作品标题/描述 |
| `cover_url` | string | "http://sns-na-i1.xhscdn.com/..." | 封面图URL |
| `post_time` | number | 1770469581000 | 发布时间（毫秒时间戳） |
| `update_time` | number | 1770469619000 | 更新时间 |
| `user_update_time` | number | 1770469581000 | 用户修改时间 |
| `audit_status` | number | 1 | 审核状态（1=已通过） |
| `tags` | array | [] | 标签列表 |
| `labels` | array | [] | 标注列表 |
| `good_names` | array | [] | 商品名称列表 |

### 2.4 时序数据（hour/day）

API 还返回小时和天级别的时序数据，包含以下时间序列：

**视频时序数据**：
- `finish5s_list` - 5秒完播率时间序列
- `finish_list` - 完播率时间序列
- `exit_view2s_list` - 2秒跳出率时间序列
- `view_time_list` - 播放时长时间序列
- `danmaku_list` - 弹幕数时间序列

**图文时序数据**：
- `avg_view_image_list` - 平均浏览图片数时间序列

**通用时序数据**：
- `view_list` - 浏览量时间序列
- `imp_list` - 曝光量时间序列
- `like_list` - 点赞数时间序列
- `comment_list` - 评论数时间序列
- `collect_list` - 收藏数时间序列
- `share_list` - 分享数时间序列
- `rise_fans_list` - 涨粉数时间序列
- `cover_click_rate_list` - 封面点击率时间序列

---

## 三、数据来源

### 3.1 API 端点

**主要数据API**：
```
GET https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/base
```

**Query 参数**：
- `note_id` - 作品ID（必需）
- `data_level` - 数据级别（如 `third_level`）
- `data_type` - 数据类型（如 `day`、`hour`）

**响应格式**：
```json
{
  "code": 0,
  "success": true,
  "msg": "成功",
  "data": {
    "full_view_rate": 0,
    "avg_view_image": 0,
    "view_count": 13,
    "like_count": 1,
    ...
    "note_info": {
      "id": "698738cd00000000280207bf",
      "type": "NORMAL",
      "desc": "作品标题",
      ...
    },
    "hour": { ... },
    "day": { ... }
  }
}
```

### 3.2 管理页面

| 页面 | URL | 数据 |
|------|-----|------|
| **作品管理** | `https://creator.xiaohongshu.com/creator/post-management` | 作品列表、基础数据 |
| **数据分析** | `https://creator.xiaohongshu.com/statistics/data-analysis` | 表格数据、趋势分析 |

---

## 四、区分规则

### 4.1 如何判断内容类型

**方法 1：基于字段值判断**（推荐）

```javascript
function getContentType(data) {
  // 如果有图文专属字段且 > 0，判定为图文
  if (data.avg_view_image && data.avg_view_image > 0) {
    return 'image';
  }

  // 如果有视频专属字段且 > 0，判定为视频
  if (data.full_view_rate > 0 || data.finish5s_rate > 0 || data.danmaku_count > 0) {
    return 'video';
  }

  // 如果有播放时长，判定为视频
  if (data.view_time_avg && data.view_time_avg > 0) {
    return 'video';
  }

  // 默认：根据 note_info.type 判断（待验证）
  return 'unknown';
}
```

**方法 2：基于 note_info.type 字段**（需要更多样本验证）

```javascript
function getContentType(noteInfo) {
  if (noteInfo.type === 'VIDEO') return 'video';
  if (noteInfo.type === 'NORMAL') {
    // NORMAL 可能是图文，但需要结合字段判断
    return 'image';
  }
  return 'unknown';
}
```

### 4.2 区分逻辑流程

```
1. 拦截 /api/galaxy/creator/datacenter/note/base API
2. 提取 data.avg_view_image 和 data.full_view_rate
3. 判断：
   - avg_view_image > 0 → 图文
   - full_view_rate > 0 或 finish5s_rate > 0 → 视频
   - view_time_avg > 0 → 视频
   - 否则 → 待定（可能是新发布作品，数据为0）
4. 保存时标注 content_type
```

---

## 五、采集策略建议

### 5.1 推荐方案：统一采集 + 后处理分类

**原因**：
- 小红书的 API 对图文和视频返回相同的字段结构
- 只是某些字段的值会是 0（类似快手）
- 与抖音不同，不需要分别处理

**实施步骤**：
1. **拦截 API**：监听 `note/base` API 响应
2. **全量保存**：保存所有字段（包括 `avg_view_image` 和 `full_view_rate`）
3. **自动分类**：根据字段值判断内容类型
4. **数据库存储**：`content_type_normalized` 字段设为 'video' 或 'image'

### 5.2 采集器升级方案

**当前状态**：
- v3 采集器：硬编码所有内容为"图文"（错误）
- v4 采集器：采集完播率，但数据为空

**建议升级**：
```javascript
// 1. 拦截 API 获取完整数据
Network.responseReceived(async (params) => {
  if (url.includes('/note/base')) {
    const data = JSON.parse(body).data;

    // 2. 自动判断内容类型
    const contentType =
      data.avg_view_image > 0 ? 'image' :
      data.full_view_rate > 0 || data.finish5s_rate > 0 || data.view_time_avg > 0 ? 'video' :
      'unknown';

    // 3. 保存完整字段
    const item = {
      title: data.note_info.desc,
      content_type: contentType,

      // 通用字段
      view_count: data.view_count,
      like_count: data.like_count,
      comment_count: data.comment_count,
      collect_count: data.collect_count,
      share_count: data.share_count,
      cover_click_rate: data.cover_click_rate,
      impl_count: data.impl_count,
      rise_fans_count: data.rise_fans_count,

      // 视频专属字段（图文时为0）
      full_view_rate: data.full_view_rate,
      finish5s_rate: data.finish5s_rate,
      exit_view2s_rate: data.exit_view2s_rate,
      view_time_avg: data.view_time_avg,
      danmaku_count: data.danmaku_count,

      // 图文专属字段（视频时为0）
      avg_view_image: data.avg_view_image
    };
  }
});
```

### 5.3 数据库 Schema 建议

**content_master 表**：
- 已有字段：`content_type_normalized` (varchar) → 存储 'video' 或 'image'
- 无需新增字段

**content_snapshots 表**：
- 需要新增的字段（如果要详细存储视频数据）：
  ```sql
  ALTER TABLE content_snapshots ADD COLUMN full_view_rate DECIMAL(5,2);
  ALTER TABLE content_snapshots ADD COLUMN finish5s_rate DECIMAL(5,2);
  ALTER TABLE content_snapshots ADD COLUMN exit_view2s_rate DECIMAL(5,2);
  ALTER TABLE content_snapshots ADD COLUMN view_time_avg DECIMAL(8,2);
  ALTER TABLE content_snapshots ADD COLUMN avg_view_image DECIMAL(5,2);
  ALTER TABLE content_snapshots ADD COLUMN cover_click_rate DECIMAL(5,2);
  ```

---

## 六、重要说明

### 6.1 数据可靠性

- ✅ API 结构已确认（基于真实响应样本）
- ⚠️ `note_info.type` 字段的取值需要更多样本验证（目前只见到 "NORMAL"）
- ⚠️ 当前测试账号只有 1 个作品，字段值大多为 0，无法验证区分逻辑的准确性

### 6.2 局限性

1. **样本不足**：只捕获到 1 个作品的数据，无法确认图文和视频的真实差异
2. **字段值为 0**：测试作品的 `avg_view_image` 和 `full_view_rate` 都是 0，可能是新发布作品或数据未更新
3. **type 字段未知**：`note_info.type` 返回 "NORMAL"，不确定是否有 "VIDEO"、"IMAGE" 等其他值

### 6.3 需要进一步验证的问题

- [ ] `note_info.type` 的所有可能取值
- [ ] 图文作品的 `avg_view_image` 实际值范围（测试样本为 0）
- [ ] 视频作品的 `full_view_rate` 实际值范围（测试样本为 0）
- [ ] 是否存在既有图片又有视频的混合作品类型

---

## 七、跨平台总结

| 维度 | 抖音 | 快手 | 小红书 |
|------|------|------|--------|
| **API 架构** | 图文/视频分开 | 统一 API | **统一 API** |
| **字段差异** | 完全不同 | 完全相同 | **部分重叠** |
| **完播率** | 仅视频 | 图文和视频都有 | **仅视频** |
| **图文专属** | 文案展开率、平均浏览图片 | 无 | **平均浏览图片** |
| **视频专属** | 平均播放时长、跳出率 | 无 | **完播率、5秒完播率、弹幕** |
| **区分方式** | API 端点不同 | 页面标识（时长 vs `-`） | **字段值判断** |
| **采集难度** | 中（需要分别处理） | 低（统一处理） | **中（需要后处理分类）** |

---

## 八、下一步行动

1. **获取更多样本数据**：
   - 使用有更多作品的测试账号
   - 确保账号中既有图文作品又有视频作品
   - 采集 20+ 条数据进行验证

2. **验证区分逻辑**：
   - 确认 `note_info.type` 的真实含义
   - 验证 `avg_view_image > 0` 能否准确识别图文
   - 验证 `full_view_rate > 0` 能否准确识别视频

3. **升级采集器**：
   - 修改 v3/v4 采集器，实现自动内容类型判断
   - 保存完整字段数据
   - 更新数据库 schema

4. **文档化**：
   - 更新 `platform-scraper` skill 文档
   - 添加小红书字段对比表
   - 记录踩坑经验

---

## 附录：参考文件

- API 样本响应：`/tmp/xiaohongshu-note-base.json`
- 字段分析数据：`/tmp/xiaohongshu-fields-analysis.json`
- v3 采集器：`/home/xx/scraper-xiaohongshu-v3.js`
- v4 采集器：`/home/xx/scraper-xiaohongshu-completion-v4.js`

---

**报告结束**
