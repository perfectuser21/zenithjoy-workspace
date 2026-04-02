# Learning: CI L2 orphan-test-check

**Branch**: cp-04021253-ci-l2-orphan-test-check
**PR**: perfectuser21/zenithjoy-workspace#112
**Date**: 2026-04-02

## 做了什么

在 CI L2 加入 `orphan-test-check` job，强制所有 `*.test.*` / `*.spec.*` 文件必须注册到
`test-registry.yaml`，未注册文件阻断 PR merge。同时随 PR 收录 3 个 registry 文件。

## 关键决策

- **LITE 路径 gate 文件必须是 JSON 格式**（含 `routing_decision: "lite"`），verify-step.sh 用 `JSON.parse` 读取。
  之前用 YAML 格式导致 gate 验证失败。

- **hook CWD 与 worktree CWD 不同**：branch-protect.sh 在 zenithjoy 主仓库 CWD 下运行，
  `git rev-parse --abbrev-ref HEAD` 返回 `main`，所以 gate 文件名是 `.dev-gate-lite.main` 而非 `.dev-gate-lite.cp-xxx`。

- **orphan-test-check 逻辑**：用 `find` 扫描 + `grep` 提取注册路径 + bash while 循环对比，纯 shell 无额外依赖。

## 踩的坑

1. worktree 创建后 test-registry.yaml 未包含在内（因为还未提交到 main），需要手动复制到 worktree
2. 本地扫描发现 `apps/api/tests/` 下有 5 个测试文件（works/fields/publish/snapshots/contract）未在初始 registry 中，需补录

## 结果

- 19 个测试文件全部注册，CI PASS
- 从此任何新增测试文件未注册 → L2 阻断
