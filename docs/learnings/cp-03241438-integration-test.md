# Learning: API Contract Tests (PR3)

**Branch**: cp-03241438-integration-test
**Date**: 2026-03-24

## 做了什么

新增 `apps/api/tests/contract.test.ts`，用 supertest + vi.mock 固化三个核心资源（works/fields/publish-logs）的 HTTP response shape，作为回归基线。

## 关键教训

### 1. vi.clearAllMocks() 不清空 once 队列（vitest v4）

`vi.clearAllMocks()` 在 vitest v4 中**不清空** `mockResolvedValueOnce` 队列，导致跨测试 mock 污染——前一个测试剩余的 once 值会泄漏给下一个测试，产生极难排查的假阴性/假阳性。

**必须用 `vi.resetAllMocks()`** 才能清空 once 队列。

### 2. Zod UUID 校验在 supertest 中失败的表现

Zod `z.string().uuid()` 会拦截非法 UUID（如 `'work-uuid-contract'`），返回 400 而非预期的 201/200。路由参数和请求体中所有 UUID 字段都要用合法的 UUID 格式（如 `'11111111-1111-1111-1111-111111111111'`）。

### 3. fields 端点返回裸数组，不包在 {data,total,...} 里

与 works 端点不同，fields 返回 `FieldDefinition[]` 裸数组。合约测试需显式区分这两种格式。

## Dashboard ↔ API 已知不一致（待后续 PR 修复）

| Dashboard 期待 | API 实际返回 |
|---------------|------------|
| `content_text` | `body` |
| `WorkStatus.pending` | `WorkStatus.ready` |
| PublishLog `scheduled/success` | `pending/published` |
| `display_label`, `is_required` | 不存在 |
