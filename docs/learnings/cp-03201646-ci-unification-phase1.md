---
branch: cp-03201646-ci-unification-phase1
date: 2026-03-20
type: learning
---

# Learning: Monorepo CI 统一化 Phase 1

## 做了什么
将 zenithjoy monorepo 的 CI 从"只检查 dashboard"升级为全模块覆盖，统一 TypeScript 配置，清理配置矛盾。

## 关键决策

1. **Dashboard 开 strict: true** — 只有 5 个类型错误，值得修。不开的话两个 app 标准不一致，技术债只会越积越多。

2. **API 统一到 Vitest** — Jest 和 Vitest 并存毫无意义。Vitest 与 dashboard 一致，且是 root package-lock.json 的 workspace 依赖链的一部分。

3. **npm workspace install** — API 和 GeoAI 没有独立的 package-lock.json，CI 中 `npm ci --workspace=apps/api` 而不是 `cd apps/api && npm ci`。

## 踩坑

### 根本原因
npm workspaces 的 monorepo 中，子 app 不一定有独立的 `package-lock.json`。CI 的 `cache-dependency-path` 指向不存在的文件会导致 `actions/setup-node` 直接报错（不是 warning）。

### 下次预防
新增 CI job 时先确认目标 app 是否有独立 lock file。如果是 workspace 模式，统一用 root 的 `package-lock.json`。

### 根本原因
从 Jest 迁移到 Vitest 不只是改 package.json — 所有 `jest.mock()`、`jest.fn()`、`jest.Mock` 类型引用都需要改成 vitest 的 `vi.mock()`、`vi.fn()` 等。setup 文件和 test 文件都要检查。

### 下次预防
做测试框架迁移时，先 `grep -r 'jest\.'` 找出所有引用点，一次改干净。

## 后续（Phase 2）
- ESLint max-warnings 从 79 逐步降到 0
- 加 coverage gate
- 给 API 加 ESLint
- 清理遗留垃圾（worktrees、临时目录）
