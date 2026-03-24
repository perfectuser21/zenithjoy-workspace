# Learning: 修复 API 测试 skip — vi.mock 方案

**Branch**: cp-03241404-fix-api-test-mock
**Date**: 2026-03-24
**PR**: #85

## 背景

`apps/api/tests/` 下三个测试文件全部被 `describe.skip` 跳过，导致 API 业务逻辑零测试覆盖。根因是开发者当时认为 CI 无数据库，直接 skip。

## 解决方案

用 `vi.mock('../src/db/connection')` 替换真实 pg Pool，每个测试用 `mockResolvedValueOnce` 控制 query 响应序列：

```ts
vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));
const mockQuery = pool.query as ReturnType<typeof vi.fn>;
```

关键模式：
- **多次 query 操作**：`updateWork()` 先调 `getWorkById()` 再 UPDATE，需按顺序链式设置两个 mock
- **409 CONFLICT**：`mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))`
- **400 Validation**：Zod 拦截在 DB 调用前，不需要 mock

## 教训

1. **Task Card 测试命令必须考虑运行目录**：DevGate hook 从 worktree 根执行命令。使用 `bash -c "cd apps/api && ..."` 而非 `npx vitest run src/...`（后者在根目录可能误匹配或无法找到）
2. **pool.query 调用计数**：list 类操作 = 2 次（COUNT + SELECT），getById = 1 次，update/delete = 2 次（getById + 操作），要提前数清楚
3. **describe.skip 是技术债陷阱**：一旦 skip，就永远不跑，永远不发现问题。新加 mock 机制比永久 skip 成本低得多

## 结果

30 个测试用例全部从 skipped → PASS，CI L1-L4 全通过。
