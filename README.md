# ZenithJoy Workspace

ZenithJoy 公司的核心工作空间，包含所有业务系统、产品开发和运营工具。

## 🏢 公司介绍

ZenithJoy 是一家专注于创新技术和产品开发的公司，致力于通过 AI 和自动化技术提升业务效率和用户体验。

## 📁 仓库结构

```
zenithjoy/
├── workspace/           # 主工作空间（前端界面）
├── workflows/          # 自动化工作流
├── creator/            # 内容创作工具
├── geoai/             # 地理 AI 分析系统
├── JNSY-Label/        # 标签管理系统
└── .claude/           # Claude Code 配置
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18.x
- PostgreSQL >= 14
- Docker & Docker Compose
- Git

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/ZenithJoycloud/zenithjoy-workspace.git
cd zenithjoy-workspace

# 安装依赖
npm install

# 启动开发环境
npm run dev
```

## 🔧 开发规范

### 分支管理

- `main` - 生产分支，稳定版本
- `develop` - 开发分支，新功能集成
- `feature/*` - 功能分支
- `hotfix/*` - 紧急修复分支

### 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 代码重构
- `test:` 测试相关
- `chore:` 构建或辅助工具的变动

### 开发流程

1. 从 `develop` 分支创建功能分支
2. 开发并提交代码
3. 创建 Pull Request 到 `develop`
4. 代码审查和 CI 检查
5. 合并到 `develop`
6. 定期从 `develop` 合并到 `main` 发布

## 📚 文档

- [系统定义](./DEFINITION.md) - 详细的系统架构和定义
- [Claude 开发指南](./.claude/CLAUDE.md) - Claude Code 开发规范

## 🤝 贡献指南

1. Fork 本仓库
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

© 2026 ZenithJoy. All rights reserved.

## 📮 联系方式

- GitHub: [@ZenithJoycloud](https://github.com/ZenithJoycloud)
- 项目维护者: Perfect21

---

*本仓库使用 Claude Code 辅助开发*