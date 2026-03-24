# Learning: 加入 API coverage 阈值

**Branch**: cp-03241427-api-coverage
**Date**: 2026-03-24
**PR**: #86

## 背景

PR1 让 30 个测试真实运行后，下一步是防止未来代码退化：给覆盖率加门槛。

## 关键决策

**阈值设在 65% 而非 80%**：ai-video 模块测试全部 skip（依赖外部 API），导致整体 statements 只有 68%。若设 70% 会立即失败，设 65% 留 3% 余量，诚实反映现状而不是用 exclude 掩盖。

**排除 4 类文件**：
1. `src/index.ts` — server entry point，不做单元测试
2. `src/test/**` — test helper，不应计入覆盖
3. `src/clients/**` — 外部 API 客户端，依赖真实网络，不做 mock
4. `src/models/types.ts` — 纯 TypeScript 类型定义，无运行时代码

**不排除 ai-video**：虽然覆盖率低，但让它出现在报告里能提醒以后补测试。

## 当前基线

| 指标 | 值 |
|------|----|
| Statements | 68.14% (阈值 65%) |
| Branches | 79.31% (阈值 65%) |
| Functions | 69.04% (阈值 65%) |
| Lines | 68.14% (阈值 65%) |

## 后续

PR3 集成测试、PR4 E2E 上线后，应将阈值提升到 75-80%。
