# API 测试修复计划

## 当前问题分析

### 1. 数据库连接问题（主要问题）
- **错误**: "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string"
- **原因**: connection.ts 使用 `DATABASE_*` 环境变量，但 .env 使用 `POSTGRES_*`
- **影响**: 26/30 测试失败（500 错误）

### 2. Vitest/Jest 混用问题
- **文件**: src/services/__tests__/ai-video.service.test.ts
- **错误**: "Vitest cannot be imported in a CommonJS module"
- **原因**: 该文件使用 vitest，但项目配置是 jest

## 修复方案

### Step 1: 环境配置 ✅ 已完成
- [x] 创建 `.env.test` 文件，使用正确的变量名（DATABASE_*）

### Step 2: 修复 ai-video.service.test.ts
需要替换：
- `import { describe, it, expect, vi, beforeEach } from 'vitest'` → 删除 vitest 导入
- `vi.mock` → `jest.mock`
- `vi.clearAllMocks()` → `jest.clearAllMocks()`
- `vi.fn()` → `jest.fn()`
- 所有 `(pool.query as ReturnType<typeof vi.fn>)` → `(pool.query as jest.MockedFunction<typeof pool.query>)`

### Step 3: Jest 配置
确保 jest 加载 .env.test：
- 选项 1: 在 jest.config.js 中添加 setupFiles
- 选项 2: 在每个测试文件开头加载 dotenv

### Step 4: 测试数据库验证
- 确认数据库连接正常
- 确认表和 schema 存在（zenithjoy.works, zenithjoy.field_definitions, etc.）

## 预期结果

- ✅ 4 个测试套件全部通过
- ✅ 30 个测试全部通过（4 passed + 26 failed → 30 passed）
- ✅ 通过率 100% (目标 >95%)
- ✅ 无数据库连接错误
- ✅ 无 vitest/jest 冲突

## 测试套件概览

| 文件 | 测试数 | 当前状态 | 问题 |
|------|--------|---------|------|
| tests/works.test.ts | 11 | 11 失败 | 数据库连接 |
| tests/fields.test.ts | 8 | 8 失败 | 数据库连接 |
| tests/publish.test.ts | 9 | 9 失败 | 数据库连接 |
| src/services/__tests__/ai-video.service.test.ts | 6 | 套件失败 | vitest 导入 |

## 执行步骤

1. 获取 PRD/DoD 批准（当前阻塞点）
2. 修复 ai-video.service.test.ts（8 处改动）
3. 配置 jest 加载 .env.test
4. 运行测试：`npm test`
5. 如果仍有失败，检查数据库 schema
6. 生成测试覆盖率报告
7. 提交 PR

## 文件清单

- [x] `.env.test` - 测试环境配置
- [ ] `src/services/__tests__/ai-video.service.test.ts` - 修复 vitest → jest
- [ ] `jest.config.js` - 可能需要添加 setupFiles
- [ ] 可能需要：`src/test/setup.ts` - 测试数据库初始化
