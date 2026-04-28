## 抖音对标账号搜索测试套件（2026-04-28）

### 根本原因

1. **模块级 env var 读取问题**：`feishu-bitable.ts` 在模块导入时读取 `process.env.FEISHU_APP_ID`，导致 vitest `beforeEach` 设置的环境变量被忽略，4 个测试失败。

2. **`require('playwright')` 在顶层**：`sop-account-search.js` 顶层 `require('playwright')`，导致纯函数测试必须安装 Playwright，不必要地提高测试依赖。

3. **Node 原生测试 API 需显式 import**：`node --test` 在 Node 25 下不自动注入 `describe`/`test`/`expect` 全局，需要从 `node:test` 显式 `require`；`expect` 需替换为 `assert`。

### 下次预防

- [ ] 任何读取 `process.env` 的服务模块，用 lazy getter（`() => process.env.X`）而不是模块级常量，保证测试 `beforeEach` 可覆盖
- [ ] 有 I/O 依赖（Playwright、DB）的脚本，将 `require` 移入主函数内部，保证纯函数部分可独立测试
- [ ] CommonJS 测试文件使用 `node:test` 而不是 Jest 全局，需手动 `require('node:test')` 并用 `assert` 替代 `expect`
