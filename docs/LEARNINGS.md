
### [2026-02-07] 平台数据展示页面开发

- **Bug**: 
  - 初始分支命名使用了 `W6-platform-data-display`，但 branch-protect hook 要求 `cp-*` 或 `feature/*` 格式，需要重命名分支
  - 创建了 `.prd-platform-data.md` 和 `.dod-platform-data.md` 但 hook 检查 `.prd.md` 和 `.dod.md`，需要重命名为标准格式

- **优化点**: 
  - 配置驱动的导航系统运作良好，只需修改 `navigation.config.ts` 即可添加新页面
  - TypeScript 类型定义清晰，每个平台有独立的数据结构
  - 流程顺畅，CI 一次性通过

- **影响程度**: Low（分支命名和文件名是小问题，不影响功能开发）

- **技术要点**:
  - 使用配置驱动 UI 架构，添加页面只需三步：1) 创建页面组件 2) 添加到 pageComponents 映射 3) 添加到 navGroups
  - Platform-specific 数据保留原始字段名，不做统一 schema 转换
  - 使用 Database icon 代表数据相关页面
  - 功能开关通过 InstanceContext 的 features 配置控制


### [2026-02-07] Platform Data API Backend

- **Bug**: None - implementation went smoothly
- **优化点**:
  - Created lightweight Node.js/Express API service for platform data
  - Used Docker for deployment with health checks
  - Updated nginx config to proxy /api/media/* requests
  - Proper separation: frontend (static) vs backend (API)
- **影响程度**: Medium - Unblocks platform data display feature
- **技术点**:
  - PostgreSQL connection pooling with `pg` library
  - Docker `host.docker.internal` for container-to-host DB access
  - nginx reverse proxy configuration for multiple API endpoints


### [2026-02-10] 数据库 Migration 脚本 - 作品管理系统

- **Bug**:
  - Write tool 需要先 Read 文件才能写入（即使是新文件）- 这导致创建 quality-summary.json 时出错
  - 解决：先 Read（即使返回错误也ok），然后 Write

- **优化点**:
  - Migration 脚本设计完善：事务包裹、幂等性设计（IF NOT EXISTS）、完整索引、外键约束
  - 测试脚本覆盖全面：7 个测试用例覆盖表创建、字段验证、类型检查、外键、默认数据、数据插入
  - 文档详细：包含执行方法、验证查询、回滚方案、Schema 设计说明
  - CI 一次性通过：所有 DevGate 检查通过，无需修复
  - /dev 工作流流畅：从 PRD 到 PR 合并一气呵成

- **影响程度**: Low - Write tool 的限制是小问题，已解决

- **技术要点**:
  - PostgreSQL Schema 设计：三个核心表（works, publish_logs, field_definitions）+ 一个扩展（platform_posts.work_id）
  - JSONB 字段应用：custom_fields（类 Notion）、media_files（图片/视频数组）、platform_links（多平台 URL）
  - 唯一约束设计：同一作品在同一平台只能有一条发布记录（work_id + platform UNIQUE）
  - 时间追踪：created_at、scheduled_at、first_published_at、updated_at、archived_at
  - 预设数据：4 个默认字段定义（标签、优先级、内部笔记、目标受众）
  - 测试策略：自动化测试脚本验证所有 DDL 操作
  - 版本管理：使用 semver，feat: 类型提交 bump minor 版本（1.4.5 → 1.5.0）

- **未来改进**:
  - Phase 2: API 实现（Node.js + Express）
  - Phase 3: 前端实现（React + TipTap 富文本编辑器）
  - Phase 4+: 多平台发布、时序数据追踪、数据分析


### [2026-02-10] Works Management API (CRUD)

- **Bug**: None - 流程非常顺畅

- **优化点**:
  - TypeScript 严格模式 + MVC 架构：代码结构清晰，类型安全
  - Zod 验证统一在 middleware：所有 POST/PUT 端点自动验证，代码简洁
  - 错误处理中间件统一格式：从 Zod/PostgreSQL/自定义错误统一转换为标准格式
  - 参数化查询防 SQL 注入：所有数据库操作使用 $1, $2 参数
  - 测试覆盖全面：31 个集成测试覆盖所有 CRUD 和错误场景
  - CI 一次性通过：类型检查 + 测试全部通过

- **影响程度**: Medium - 完成 Phase 1，为前端实现打好基础

- **技术要点**:
  - **MVC 架构**: routes (定义端点) → controllers (处理请求) → services (业务逻辑)
  - **Zod 验证**:
    - 创建 schema (createWorkSchema, updateWorkSchema 等)
    - 使用 validate() 中间件自动验证
    - 验证失败自动返回 400 + 详细错误
  - **错误处理**:
    - ZodError → VALIDATION_ERROR (400)
    - ApiError → 自定义状态码
    - PostgreSQL 23505 → CONFLICT (409, 唯一约束)
    - PostgreSQL 23503 → VALIDATION_ERROR (400, 外键)
    - 其他 → INTERNAL_ERROR (500)
  - **PostgreSQL 连接池**:
    - pg.Pool (max: 20 connections)
    - 参数化查询：query(sql, [param1, param2])
    - 动态 WHERE 条件构建
  - **动态 UPDATE 查询**:
    ```typescript
    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = $${paramIndex++}`);
      values.push(value);
    });
    ```
  - **JSON 字段处理**:
    - 写入：JSON.stringify(value)
    - 读取：PostgreSQL 自动解析 JSONB
  - **级联删除**: DELETE works 自动删除 publish_logs (ON DELETE CASCADE)
  - **唯一约束测试**: 测试 field_name 唯一性和 (work_id, platform) 唯一性

- **API 设计亮点**:
  - REST 风格一致：GET/POST/PUT/DELETE 语义清晰
  - 筛选参数：type/status/account/limit/offset/sort/order
  - 嵌套资源：/api/works/:workId/publish-logs
  - 统一响应格式：ListResponse<T> { data, total, limit, offset }

- **测试策略**:
  - Jest + Supertest 集成测试
  - afterAll 自动清理测试数据
  - 测试所有成功路径 + 错误路径
  - 约束测试（唯一性、外键、NOT NULL）

- **文档完整性**:
  - README 包含所有端点的 curl 示例
  - 环境变量说明清晰
  - 项目结构可视化
  - 错误码表格

- **下一步**:
  - Phase 2: 前端实现（作品列表 Database View）
  - 集成测试可以在本地运行，也可以在 CI 中运行
  - 考虑添加 API 文档生成（Swagger/OpenAPI）
