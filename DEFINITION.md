# ZenithJoy System Definition

## 产品分类 SSOT

**App / Line / Golden Path 的分类事实存放在 `product-map/product-map.yaml`，不在本文件中。**

查阅当前分类：
```
product-map/generated/product-map.md
```

校验分类是否漂移：
```bash
npm run product-map:check
```

---

## 系统架构

ZenithJoy 是一个综合性的业务管理和自动化平台，旨在通过 AI 技术和自动化流程提升企业运营效率。

### 核心组件

#### 1. Workspace（工作空间）
- 统一的前端管理界面
- React + TypeScript + Vite
- 端口: 5213（开发）/ 5214（生产）

#### 2. Creator（内容创作系统）
- AI 驱动的内容生成和管理平台
- Next.js + Python Backend

#### 3. GeoAI（地理 AI 分析）
- 地理数据智能分析系统
- Python + PostGIS + Leaflet

#### 4. JNSY-Label（标签管理系统）
- 统一的标签和分类管理平台
- Node.js + PostgreSQL

#### 5. Workflows（工作流引擎）
- 业务流程自动化平台
- n8n + Custom Workflows

---

## 技术架构

### 数据库架构
- **主数据库**: PostgreSQL (zenithjoy)
- **缓存层**: Redis
- **文件存储**: NAS

### 部署架构

| 组件 | 服务器 | 环境 | 端口 |
|------|--------|------|------|
| Workspace | 香港 VPS | 生产 | 5213 |
| Workspace Dev | 美国 VPS | 开发 | 5214 |
| Creator | 香港 VPS | 生产 | 5215 |
| GeoAI | 香港 VPS | 生产 | 5216 |
| PostgreSQL | 香港 VPS | 生产 | 5432 |
| Redis | 香港 VPS | 生产 | 6379 |

---

## 开发规范

- TypeScript for 类型安全
- ESLint + Prettier for 代码格式
- Conventional Commits for 提交信息
- GitHub Flow for 分支管理

---

最后更新: 2026-07-28
版本: 2.0.0（thin 指针 — 分类事实已迁移至 product-map/product-map.yaml）
