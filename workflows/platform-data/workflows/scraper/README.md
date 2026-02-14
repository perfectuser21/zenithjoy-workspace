# Scraper Workflow - 数据采集

> 社交媒体平台数据自动化采集工具

## 功能说明

自动采集 8 个主流社交媒体平台的内容数据，包括：
- 帖子内容
- 互动数据（播放、点赞、评论、分享等）
- 性能指标（完播率、跳出率等）
- 发布时间和状态

## 支持的平台

| 平台 | 脚本文件 | Chrome CDP 端口 |
|------|---------|----------------|
| 抖音 | scraper-douyin-v3.js | 19222 |
| 快手 | scraper-kuaishou-v3.js | 19223 |
| 小红书 | scraper-xiaohongshu-v3.js | 19224 |
| 视频号 | scraper-channels-v3.js | 19225 |
| 今日头条 | scraper-toutiao-v3.js | 19226 |
| 微博 | scraper-weibo-v3.js | 19227 |
| 知乎 | scraper-zhihu-v3.js | 19228 |
| 微信公众号 | scraper-wechat-v3.js | 19229 |

## 使用方式

### 通过 Feature Skill

```bash
/platform-data scrape <platform>
```

### 直接调用

```bash
node apps/features/platform-data/workflows/scraper/scripts/scraper-douyin-v3.js
```

## 数据存储

所有采集的数据存储到 TimescaleDB：

- **表名**: `platform_posts`
- **Schema**: 参见 `shared/types/platform-types.ts`

## 技术栈

- **浏览器自动化**: Chrome DevTools Protocol (CDP)
- **数据库**: TimescaleDB (PostgreSQL)
- **运行时**: Node.js 18+

## 工作流程

```
1. 连接 CDP (Chrome DevTools Protocol)
2. 导航到平台后台页面
3. 解析 API 响应或 DOM 元素
4. 提取数据字段
5. 存储到 TimescaleDB
6. 记录采集日志
```

## 故障排查

### Chrome CDP 连接失败

检查浏览器是否在指定端口运行：
```bash
lsof -i :19222
```

### 数据库连接失败

检查 TimescaleDB 是否运行：
```bash
docker ps | grep timescaledb
```

### 采集失败

查看日志：
```bash
tail -f /tmp/scraper-<platform>.log
```

## 维护

- **数据质量**: 定期检查采集数据的完整性
- **API 变更**: 平台 API 变更时需要更新解析逻辑
- **性能优化**: 根据采集量调整并发和频率

## 相关文档

- [Feature 总览](../../README.md)
- [数据分析 Workflow](../analyzer/README.md)
- [内容发布 Workflow](../publisher/README.md)
