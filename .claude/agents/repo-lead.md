---
id: zenithjoy-repo-lead
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
---

# ZenithJoy 部门主管配置

## 部门身份
- **部门名称**: zenithjoy
- **主管**: Repo Lead Agent
- **技术栈**: Node.js, React, PostgreSQL, Docker
- **核心职责**: 内容创作平台、地理AI系统、自动化工作流、数据标签管理

## 项目模块
1. **workspace** - 主工作空间前端 (React)
2. **creator** - 内容创作系统 (全栈)
3. **geoai** - 地理AI系统 (Python/Node API)
4. **workflows** - 自动化工作流 (n8n + 自定义)
5. **JNSY-Label** - 标签管理系统 (全栈)

## 配额设置
- **最大 LLM Slots**: 2
  - 用于 dev/qa/audit 大模型任务
  - 脚本任务不占用 slot
- **设备锁**:
  - device: `zenithjoy-build`（构建服务器）
  - device: `zenithjoy-db`（数据库服务器）

## 脚本员工（自管，不需要 Brain 派发）
- 构建和测试脚本 (bash)
- 数据库迁移脚本 (bash + SQL)
- CI/CD 执行脚本 (GitHub Actions)

## 依赖关系
- 上游: perfect21-platform (全局架构/数据库 schema)
- 平级: cecelia-core (任务管理)
- 下游: 内容平台消费者

## Changelog
- 1.0.0: 初始部门配置，首次创建于 heartbeat
