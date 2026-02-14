# Platform Data Feature

> 社交媒体数据采集、分析、发布一体化管理系统

## 📋 概述

Platform Data 是一个完整的社交媒体数据管理 Feature，整合了三个核心 workflows：

1. **Scraper** - 数据采集（8 个平台）
2. **Analyzer** - 数据分析和洞察
3. **Publisher** - 内容自动化发布

## 🏗️ 架构

```
apps/features/platform-data/
│
├── skill/                         # Feature 统一入口
│   ├── SKILL.md                   # Skill 文档
│   ├── command.sh                 # 路由脚本
│   └── subcommands/               # 子命令实现
│       ├── scrape.sh              # 数据采集
│       ├── analyze.sh             # 数据分析
│       └── publish.sh             # 内容发布
│
├── workflows/                     # 三个 workflows
│   ├── scraper/                   # 数据采集
│   │   ├── scripts/               # 8 个平台脚本
│   │   │   ├── scraper-douyin-v3.js
│   │   │   ├── scraper-kuaishou-v3.js
│   │   │   ├── scraper-xiaohongshu-v3.js
│   │   │   ├── scraper-channels-v3.js
│   │   │   ├── scraper-toutiao-v3.js
│   │   │   ├── scraper-weibo-v3.js
│   │   │   ├── scraper-zhihu-v3.js
│   │   │   └── scraper-wechat-v3.js
│   │   └── README.md
│   │
│   ├── analyzer/                  # 数据分析
│   │   ├── scripts/
│   │   │   └── analyze.js
│   │   └── README.md
│   │
│   └── publisher/                 # 内容发布
│       ├── scripts/
│       │   └── publish.js
│       └── README.md
│
├── shared/                        # 共享代码（将来扩展）
│   ├── types/                     # TypeScript 类型定义
│   ├── utils/                     # 工具函数
│   └── config/                    # 配置文件
│
└── README.md                      # 本文档
```

## 🚀 快速开始

### 安装

Feature 已集成到 Cecelia Workspace，无需额外安装。

### 使用

```bash
# 数据采集
/platform-data scrape douyin       # 采集抖音数据
/platform-data scrape kuaishou     # 采集快手数据

# 数据分析
/platform-data analyze             # 分析所有平台
/platform-data analyze --platform douyin --days 7

# 内容发布
/platform-data publish             # 发布到今日头条
/platform-data publish --queue 2026-02-10
```

## 📦 Workflows 详情

### 1. Scraper Workflow

**功能**: 自动化采集 8 个社交媒体平台的数据

**支持平台**:
- 抖音 (Douyin)
- 快手 (Kuaishou)
- 小红书 (Xiaohongshu)
- 微信视频号 (Channels)
- 今日头条 (Toutiao)
- 微博 (Weibo)
- 知乎 (Zhihu)
- 微信公众号 (WeChat)

**数据存储**: TimescaleDB (`platform_posts` 表)

**文档**: [workflows/scraper/README.md](workflows/scraper/README.md)

### 2. Analyzer Workflow

**功能**: 数据分析和洞察生成

**分析维度**:
- 平台表现对比
- 内容类型分析（图文 vs 视频）
- 时间趋势
- 互动率统计
- 完播率分析

**输出格式**: 控制台 / JSON 导出

**文档**: [workflows/analyzer/README.md](workflows/analyzer/README.md)

### 3. Publisher Workflow

**功能**: 自动化内容发布

**支持平台**: 今日头条（更多平台开发中）

**功能特性**:
- 队列管理
- 批量发布
- 状态追踪
- 自动重试

**文档**: [workflows/publisher/README.md](workflows/publisher/README.md)

## 🔧 技术栈

- **语言**: Node.js 18+
- **数据库**: TimescaleDB (PostgreSQL)
- **浏览器自动化**: Chrome DevTools Protocol
- **文件传输**: rsync
- **部署**: Cecelia Workspace

## 📊 数据流

```
┌─────────────┐
│   平台后台   │ (抖音、快手等 8 个)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Scraper   │ (Chrome CDP 采集)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ TimescaleDB │ (platform_posts 表)
└──────┬──────┘
       │
       ├───────┐
       ▼       ▼
┌──────────┐ ┌──────────┐
│ Analyzer │ │Publisher │
└──────────┘ └──────────┘
       │           │
       ▼           ▼
   洞察报告    自动发布
```

## 🔗 依赖服务

### 必需

- **TimescaleDB**: 数据存储
  ```bash
  docker ps | grep timescaledb
  ```

- **Chrome CDP**: 浏览器自动化
  - 端口: 19222-19230
  - 检查: `lsof -i :19222`

### 可选

- **Windows 发布机**: Publisher workflow 需要
  - IP: 100.97.242.124 (Tailscale)
  - CDP: 19225

## 📚 详细文档

- [Skill 使用说明](skill/SKILL.md)
- [Scraper Workflow](workflows/scraper/README.md)
- [Analyzer Workflow](workflows/analyzer/README.md)
- [Publisher Workflow](workflows/publisher/README.md)

## 🛠️ 开发

### 添加新平台（Scraper）

1. 创建 `workflows/scraper/scripts/scraper-<platform>-v3.js`
2. 实现采集逻辑
3. 更新 `skill/subcommands/scrape.sh` 支持列表

### 添加新分析维度（Analyzer）

1. 修改 `workflows/analyzer/scripts/analyze.js`
2. 添加新的 SQL 查询
3. 更新报告输出格式

### 支持新发布平台（Publisher）

1. 创建新的发布脚本
2. 实现平台特定的自动化逻辑
3. 更新 `skill/subcommands/publish.sh`

## 🐛 故障排查

### Scraper 采集失败

1. 检查 Chrome CDP 连接
2. 检查 TimescaleDB 连接
3. 查看日志: `/tmp/scraper-<platform>.log`

### Analyzer 查询慢

1. 检查数据库索引
2. 限制查询时间范围
3. 使用 TimescaleDB 时间序列优化

### Publisher 发布失败

1. 检查 Windows 发布机连接
2. 检查文件传输是否成功
3. 查看日志: `/tmp/publisher-<platform>.log`

## 📈 未来计划

- [ ] 实现 shared/ 共享代码层
- [ ] 支持更多平台（Scraper & Publisher）
- [ ] 添加数据可视化（Analyzer）
- [ ] 实现定时任务调度
- [ ] 集成 Cecelia Brain 自动分析

## 👥 维护

- **负责人**: Perfect21
- **仓库**: `cecelia-workspace`
- **位置**: `apps/features/platform-data/`
- **创建日期**: 2026-02-10

## 📄 License

Internal use only - Part of Cecelia ecosystem
