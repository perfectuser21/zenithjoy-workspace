## ai-video upload 端点修复（2026-05-25）

### 根本原因

PR #294 的原实现在 `dispatch()` 调用 `execSync(ssh/scp)` 后，立即调用 `getGenerationById()` 查 DB。`execSync` 阻塞 Node.js 事件循环时，pg-pool 的 `connectionTimeoutMillis: 2000ms` 超时，导致 POST /api/ai-video/upload 首次请求必然返回 INTERNAL_ERROR。

PR #294 的 CI 失败原因：
1. 上游 `@types/multer` 未安装（已后续加入 main），Typecheck 报错
2. 3 个修改的 src 文件缺配套 unit test（lint-test-pairing 失败）
3. PR 标题缺 `[CONFIG]` 标签但修改了 smoke 脚本（ci-config-audit 失败）

### 下次预防

- [ ] upload + async dispatch 组合：**dispatch 前先写 DB，dispatch 后直接返回已知数据，不再查 DB**
- [ ] 修改 `.github/workflows/scripts/smoke/` 中的文件 → PR 标题必须加 `[CONFIG]` 前缀
- [ ] PR 涉及修改或新增的 src 文件，必须同步新建配套 test 文件（lint-test-pairing 校验）
- [ ] 新分支要在 multer 安装后才能引入相关类型（确认 package.json 依赖齐全）
