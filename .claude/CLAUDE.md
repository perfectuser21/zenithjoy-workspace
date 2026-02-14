# ZenithJoy 开发指南

## 项目概述

你正在开发 ZenithJoy 工作空间，这是 ZenithJoy 公司的核心业务平台。

## 开发原则

### 1. 代码质量
- 所有代码必须通过 ESLint 和 TypeScript 检查
- 保持代码简洁、可读、可维护
- 遵循 DRY（Don't Repeat Yourself）原则
- 使用有意义的变量名和函数名

### 2. 安全第一
- 永远不要在代码中硬编码敏感信息
- 使用环境变量管理配置
- 所有 API 端点必须有适当的认证和授权
- 定期更新依赖以修复安全漏洞

### 3. 性能优化
- 避免不必要的重新渲染
- 使用懒加载和代码分割
- 优化数据库查询
- 实施适当的缓存策略

## 项目结构

```
zenithjoy/
├── workspace/          # 主工作空间前端
│   ├── src/
│   ├── public/
│   └── package.json
├── creator/           # 内容创作系统
│   ├── frontend/
│   ├── backend/
│   └── docker-compose.yml
├── geoai/            # 地理 AI 系统
│   ├── api/
│   ├── models/
│   └── utils/
├── workflows/        # 自动化工作流
│   ├── n8n/
│   └── custom/
└── JNSY-Label/      # 标签管理系统
    ├── server/
    └── client/
```

## 开发工作流

### 1. 功能开发
```bash
# 1. 从 develop 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name

# 2. 开发和提交
git add .
git commit -m "feat: your feature description"

# 3. 推送并创建 PR
git push origin feature/your-feature-name
# 在 GitHub 上创建 PR 到 develop
```

### 2. Bug 修复
```bash
# 紧急修复走 hotfix 分支
git checkout main
git checkout -b hotfix/bug-description

# 修复后合并到 main 和 develop
```

### 3. 代码审查
- 所有代码必须经过 PR 审查
- 至少需要一个审查者批准
- CI 检查必须全部通过

## API 规范

### RESTful 设计
```
GET    /api/resources     # 获取列表
GET    /api/resources/:id # 获取单个
POST   /api/resources     # 创建
PUT    /api/resources/:id # 更新
DELETE /api/resources/:id # 删除
```

### 响应格式
```json
{
  "success": true,
  "data": {},
  "message": "操作成功",
  "timestamp": "2026-02-15T12:00:00Z"
}
```

### 错误处理
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": {}
  },
  "timestamp": "2026-02-15T12:00:00Z"
}
```

## 数据库规范

### 命名约定
- 表名: 小写，复数形式，下划线分隔
- 字段名: 小写，下划线分隔
- 索引名: idx_表名_字段名

### 必要字段
每个表都应包含:
- id: 主键
- created_at: 创建时间
- updated_at: 更新时间
- deleted_at: 软删除时间（如需要）

## 前端规范

### 组件设计
- 使用函数组件和 Hooks
- 组件职责单一
- 使用 TypeScript 定义 Props
- 提供默认 Props 值

### 状态管理
- 本地状态使用 useState/useReducer
- 全局状态使用 Context API 或状态管理库
- 异步数据使用 React Query 或 SWR

### 样式规范
- 使用 CSS Modules 或 styled-components
- 遵循 BEM 命名规范
- 响应式设计优先
- 支持暗色模式

## 测试要求

### 测试类型
1. **单元测试**: 测试独立函数和组件
2. **集成测试**: 测试模块间交互
3. **E2E 测试**: 测试完整用户流程

### 测试覆盖率
- 目标覆盖率: 80%
- 关键业务逻辑: 100%
- 新功能必须包含测试

## 部署流程

### 环境管理
- 开发环境: develop 分支自动部署
- 测试环境: release/* 分支
- 生产环境: main 分支，需手动确认

### 部署检查清单
- [ ] 代码审查通过
- [ ] 所有测试通过
- [ ] 文档更新完成
- [ ] 数据库迁移准备就绪
- [ ] 回滚方案准备

## 监控和日志

### 日志级别
- ERROR: 错误信息
- WARN: 警告信息
- INFO: 一般信息
- DEBUG: 调试信息

### 监控指标
- 应用性能 (APM)
- 错误率和错误类型
- API 响应时间
- 数据库查询性能

## 常见问题

### Q: 如何处理敏感配置？
A: 使用 .env 文件，确保在 .gitignore 中，提供 .env.example

### Q: 如何处理大文件？
A: 使用 NAS 存储，数据库只存储文件路径

### Q: 如何优化性能？
A: 使用缓存、CDN、代码分割、懒加载等技术

## 联系方式

- 项目负责人: Perfect21
- 技术支持: 通过 Cecelia 系统
- 紧急联系: 查看团队文档

---

最后更新: 2026-02-15
版本: 1.0.0