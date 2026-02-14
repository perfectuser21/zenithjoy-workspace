# Platform Data Management - Feature Skill

> 社交媒体数据采集、分析、发布一体化管理

## 🎯 功能概览

Platform Data 是一个完整的社交媒体数据管理 Feature，包含三个核心 workflows：

1. **Scraper** - 数据采集（支持 8 个平台）
2. **Analyzer** - 数据分析
3. **Publisher** - 内容发布

## 📋 使用方式

### 子命令

```bash
# 数据采集
/platform-data scrape <platform> [options]

# 数据分析
/platform-data analyze [options]

# 内容发布
/platform-data publish [options]
```

### 示例

```bash
# 采集抖音数据
/platform-data scrape douyin

# 采集快手数据
/platform-data scrape kuaishou

# 分析所有平台数据
/platform-data analyze

# 发布内容到今日头条
/platform-data publish
```

## 🔧 支持的平台

### Scraper Workflow

- 抖音 (Douyin)
- 快手 (Kuaishou)
- 小红书 (Xiaohongshu)
- 微信视频号 (Channels)
- 今日头条 (Toutiao)
- 微博 (Weibo)
- 知乎 (Zhihu)
- 微信公众号 (WeChat)

## 📂 架构

```
apps/features/platform-data/
├── skill/                     # Feature 统一入口
│   ├── SKILL.md              # 本文档
│   ├── command.sh            # 路由脚本
│   └── subcommands/          # 子命令实现
│       ├── scrape.sh
│       ├── analyze.sh
│       └── publish.sh
│
├── workflows/                # 三个 workflows
│   ├── scraper/
│   │   ├── scripts/         # 8 个平台采集脚本
│   │   └── README.md
│   │
│   ├── analyzer/
│   │   ├── scripts/         # 分析脚本
│   │   └── README.md
│   │
│   └── publisher/
│       ├── scripts/         # 发布脚本
│       └── README.md
│
├── shared/                   # 共享代码（将来）
│   ├── types/
│   ├── utils/
│   └── config/
│
└── README.md                # Feature 总览
```

## 🔗 依赖

- Node.js 18+
- TimescaleDB (数据存储)
- Chrome DevTools Protocol (浏览器自动化)

## 📚 详细文档

- [Scraper Workflow](../workflows/scraper/README.md)
- [Analyzer Workflow](../workflows/analyzer/README.md)
- [Publisher Workflow](../workflows/publisher/README.md)
- [Feature 总览](../README.md)

## 🚀 快速开始

1. 确保依赖服务运行：
   - TimescaleDB: `docker ps | grep timescaledb`
   - Chrome CDP: 检查端口 19222-19230

2. 采集数据：
   ```bash
   /platform-data scrape douyin
   ```

3. 分析数据：
   ```bash
   /platform-data analyze
   ```

4. 发布内容：
   ```bash
   /platform-data publish
   ```

## 💡 常见问题

### Q: 如何添加新平台？

A: 在 `workflows/scraper/scripts/` 下添加新的 `scraper-<platform>-v3.js` 文件。

### Q: 数据存储在哪里？

A: TimescaleDB 数据库，表名：`platform_posts`

### Q: 如何查看采集历史？

A: 使用 analyzer workflow 查询数据库。

## 🔧 维护

- **负责人**: Perfect21
- **仓库**: cecelia-workspace
- **位置**: `apps/features/platform-data/`
