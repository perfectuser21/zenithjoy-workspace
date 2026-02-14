# Analyzer Workflow - 数据分析

> 社交媒体数据分析和洞察工具

## 功能说明

从 TimescaleDB 查询和分析平台数据，生成洞察报告：
- 平台表现对比
- 内容类型分析
- 时间趋势分析
- 互动率统计
- 完播率分析

## 使用方式

### 通过 Feature Skill

```bash
# 分析所有平台数据
/platform-data analyze

# 分析特定平台
/platform-data analyze --platform douyin

# 分析最近 7 天数据
/platform-data analyze --days 7

# 导出分析结果
/platform-data analyze --export
```

### 直接调用

```bash
node apps/features/platform-data/workflows/analyzer/scripts/analyze.js
```

## 分析维度

### 1. 平台对比

- 总播放量
- 平均完播率
- 互动率排名
- 涨粉效果

### 2. 内容类型

- 图文 vs 视频
- 短视频 vs 长视频
- 不同话题表现

### 3. 时间趋势

- 每日发布量
- 周末 vs 工作日
- 最佳发布时间

### 4. 性能指标

- 完播率分布
- 跳出率分析
- 点击率统计

## 数据来源

- **数据库**: TimescaleDB
- **表名**: `platform_posts`
- **查询**: SQL + TimescaleDB 时间序列函数

## 输出格式

### 控制台输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  平台数据分析报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 抖音 (Douyin)
  - 总播放: 1,234,567
  - 完播率: 45.6%
  - 互动率: 3.2%

📊 快手 (Kuaishou)
  - 总播放: 987,654
  - 完播率: 38.9%
  - 互动率: 2.8%
```

### JSON 导出

```json
{
  "generated_at": "2026-02-10T14:30:00Z",
  "platforms": [
    {
      "name": "douyin",
      "metrics": {
        "total_views": 1234567,
        "avg_completion_rate": 0.456,
        "engagement_rate": 0.032
      }
    }
  ]
}
```

## 技术栈

- **数据库查询**: PostgreSQL + TimescaleDB
- **数据处理**: Node.js
- **可视化**: (将来可以添加图表生成)

## 相关文档

- [Feature 总览](../../README.md)
- [数据采集 Workflow](../scraper/README.md)
- [内容发布 Workflow](../publisher/README.md)
