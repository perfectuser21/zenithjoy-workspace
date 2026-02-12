
### [2026-02-12] AI 视频生成任务状态显示修复

- **Bug**:
  - ToAPI 返回的任务对象 `status` 字段为 undefined，导致 TaskMonitor 组件返回 null，页面空白
  - Console 显示重复错误："Unknown task status: undefined"
  - 前端期望 status 值为 'queued' | 'in_progress' | 'completed' | 'failed'
  - ToAPI 实际可能返回不同的字段名（如 'state'）或不同的状态值（如 'pending', 'processing', 'success'）

- **解决方案**:
  - 添加 `mapToAPIResponse()` 数据映射层，处理字段名和状态值差异
  - 支持多种字段名映射（state → status）
  - 支持多种状态值映射（pending → queued, processing → in_progress, success → completed）
  - TaskMonitor 添加兜底配置，undefined status 显示"加载中"而非空白
  - 添加调试日志打印 ToAPI 原始响应格式

- **优化点**:
  - 通过 Export mapToAPIResponse 使其可测试
  - 添加全面的单元测试覆盖映射逻辑（8个测试用例）
  - 添加 TaskMonitor 兜底行为测试（6个测试用例）
  - CI 第一次失败（TypeScript + ESLint 错误），修复后一次通过

- **影响程度**: Medium - 用户无法看到视频生成进度是功能性问题，需要尽快修复

- **技术要点**:
  - 第三方 API 集成时需要考虑数据格式不匹配
  - 添加数据映射层比直接修改类型定义更安全
  - 组件应该有兜底 UI，避免因意外数据导致空白页面
  - 使用 `vi.mock()` 和 ES6 imports 避免 ESLint 的 `@typescript-eslint/no-require-imports` 错误


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

### [2026-02-10] Works List Frontend (Database View)

- **Bug**:
  - React Query v5 兼容性：`keepPreviousData` 已移除，需要使用 `placeholderData: keepPreviousData`（本次直接删除）
  - Mutations API 变化：`isLoading` 改为 `isPending`
  - ESLint 严格检查：空接口需要显式禁用规则，`Record<string, any>` 需改为 `Record<string, unknown>`
  - vitest 未安装，不应创建 vitest 测试文件（按 DoD 使用手动测试）

- **优化点**:
  - 配置驱动导航系统运作良好，添加新页面只需三步
  - React Query 数据层架构清晰，useQuery + useMutation 模式简洁
  - 筛选、排序、分页逻辑统一，URL 参数自动同步
  - 空状态、加载状态、错误状态处理完善
  - TypeScript 类型定义完整，类型安全性高

- **影响程度**: Low-Medium（兼容性问题需要了解，但解决后不影响功能）

- **技术要点**:
  - **React Query v5 迁移**：
    - ❌ `keepPreviousData: true` → 删除或使用 `placeholderData`
    - ❌ `isLoading` (mutations) → ✅ `isPending`
  - **筛选器实现**：
    - URL 参数管理：filters 对象 → query params
    - 组合筛选：type + status + account + search
    - 分页重置：筛选变化时 `offset: 0`
  - **排序实现**：
    - 点击表头切换排序字段
    - 再次点击切换 asc/desc
    - 显示排序方向指示器（↑↓）
  - **分页实现**：
    - 计算：currentPage = offset / limit + 1
    - 切换页码：更新 offset
    - 切换页大小：重置 offset
  - **新建对话框**：
    - useMutation + queryClient.invalidateQueries
    - 表单验证：必填字段检查
    - 成功后自动刷新列表
  - **UI 设计**：
    - Tailwind CSS 响应式布局
    - 毛玻璃效果对话框
    - Lucide Icons 图标
    - 深色模式支持

- **下一步**:
  - 集成 Works API (apps/api) 进行完整的端到端测试
  - 添加批量操作、导出等高级功能（后续优化）

### [2026-02-10] Works Detail Page (Phase 3)

- **Bug**:
  - React Hooks 规则违规：early return 不能在 hooks 之前
  - 解决：将所有 hooks 移到组件顶层，使用 useEffect 处理 ID 检查，条件返回放在所有 hooks 之后

- **优化点**:
  - TipTap 编辑器集成顺利，工具栏和基础功能实现完整
  - useAutoSave hook 设计良好，2秒延迟 + Ctrl+S 手动保存
  - MediaUploader 支持拖拽上传，用户体验好
  - CustomFieldsEditor 使用预定义字段，简化了 Phase 3 范围

- **影响程度**: Low-Medium

- **技术要点**:
  - **React Hooks 规则**：所有 hooks 必须在组件顶层无条件调用
    - ❌ 错误：`if (!id) return null; const { work } = useWorkDetail(id);`
    - ✅ 正确：`const { work } = useWorkDetail(id || ''); if (!id) return null;`
  - **TipTap 集成**：
    - StarterKit + Image + Link extensions
    - 自定义工具栏（粗体、斜体、标题、列表、代码、链接、图片）
    - EditorContent 组件负责渲染
  - **自动保存策略**：
    - useAutoSave hook 使用 useRef 保存状态，避免不必要的重新渲染
    - 组件卸载时自动保存
    - 防抖设计（clearTimeout + setTimeout）
  - **URL 对象内存管理**：
    - MediaUploader 使用 `URL.createObjectURL()` 预览本地文件
    - 实际项目需要上传到服务器或云存储
  - **版本号升级**：feat 类型 → minor 版本（1.2.1 → 1.3.0）

- **CI 经验**:
  - ESLint rules-of-hooks 检查非常严格
  - 需要理解 React Hooks 的底层原理（调用顺序一致性）
  - 修复后立即 push，避免本地积累多个 commit

- **下一步**:
  - Phase 4: 字段管理（动态字段配置）
  - 媒体文件上传集成（云存储或服务器）
  - 端到端测试（前端 + API）

### [2026-02-10] Field Management (Phase 4)

- **Bug**: None - 流程极其顺畅，一次性通过

- **优化点**:
  - @hello-pangea/dnd 拖拽库已安装，直接使用
  - 分组展示设计（核心字段 vs 自定义字段）提高了可维护性
  - 字段类型选择器封装良好，支持 7 种类型
  - 模态对话框编辑器 UX 流畅（新增/编辑共用组件，根据 field 参数判断模式）
  - 字段排序逻辑清晰：分别管理核心字段和自定义字段的顺序
  - TypeScript 类型定义完整，CORE_FIELDS 常量确保核心字段不可删除

- **影响程度**: Low - 整个开发过程无阻碍

- **技术要点**:
  - **@hello-pangea/dnd 拖拽实现**:
    - DragDropContext 包裹整个列表
    - 两个独立的 Droppable 区域（core-fields, custom-fields）
    - Draggable 包裹每个 FieldItem
    - onDragEnd 处理排序逻辑，调用 onReorder 更新后端
  - **字段类型系统**:
    - FieldType 联合类型：'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'number' | 'checkbox'
    - FIELD_TYPE_LABELS 映射中文标签
    - CORE_FIELDS 常量定义不可删除字段
  - **编辑器组件设计**:
    - field 参数为空 = 新增模式
    - field 参数有值 = 编辑模式
    - 编辑模式下 field_name 和 field_type 不可修改（disabled）
    - select/multiselect 类型动态显示选项编辑器
    - checkbox 类型使用特殊的默认值控件
  - **React Query 集成**:
    - useFieldDefinitions hook 封装所有操作
    - createField/updateField/deleteField mutations
    - reorderFields mutation 批量更新 display_order
    - 自动 invalidateQueries 刷新列表
  - **UI 交互细节**:
    - 拖拽时显示半透明效果（isDragging）
    - 删除操作需要确认对话框（window.confirm）
    - 核心字段隐藏"编辑"和"删除"按钮
    - 显示/隐藏切换使用 Eye/EyeOff 图标
  - **路由配置**:
    - /works/fields 页面路径
    - requireAuth: true 权限控制
    - FieldManagementPage 懒加载

- **设计亮点**:
  - 核心字段与自定义字段分组：清晰区分系统字段和用户字段
  - 拖拽手柄 GripVertical：直观的拖拽交互
  - 字段卡片设计：包含所有关键信息（类型、选项、默认值、必填标识）
  - 模态编辑器：避免页面跳转，提高操作效率

- **版本号管理**:
  - feat 类型 commit → minor 版本（1.3.0 → 1.4.0）
  - 同步更新 package.json、VERSION 文件、package-lock.json

- **DoD 执行经验**:
  - 11 个功能区域全部使用 manual 测试方法
  - TypeScript typecheck + Vite build 作为基础质量保证
  - CI 一次性通过，无需修复

- **下一步**:
  - Phase 5: 多平台发布功能（使用 field_definitions 配置）
  - 在 Works Detail Page 集成动态字段显示
  - 添加字段导入/导出功能（可选优化）
