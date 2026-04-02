## ZenithJoy DB 建表 + 爬虫直传美国架构（2026-04-02）

### 根本原因

本次 CI 共失败 3 项（L1/L3/L4），根本原因各不相同：

1. **L1 Frontend Browser DoD Check 失败**
   根本原因：Task Card 在 `.gitignore` 中，未随代码提交。CI 回退到检查 `.dod.md`（另一个旧任务的 DoD），该文件不含 `manual:chrome:` 步骤，触发 Frontend Browser DoD 检查失败。
   修复：用 `git add -f` 强制提交 Task Card，并补充 `manual:chrome:` 步骤。

2. **L3 Security Audit 失败**
   根本原因：CI 使用 npm 10.x（Node 20 标准配置），其 advisory database 将 `lodash <=4.17.23` 标记为高危。本地使用 npm 11.x + Node 25，advisory 不一致导致本地 `npm audit --omit=dev` 通过而 CI 失败。
   修复：直接编辑 package-lock.json 将 lodash 升级至 4.18.1，同时在 package.json 添加 `overrides` + 直接依赖。

3. **L4 API Test 覆盖率失败**
   根本原因：新增 `snapshots.ts`（158行）后，整体语句覆盖率从约 70% 降至 62.14%，低于 65% 阈值。新路由文件无对应测试。
   修复：新增 `tests/snapshots.test.ts`，14 个测试用例覆盖 ingest/platform/work 三个端点的成功路径、错误路径、边界条件。

### 下次预防

- [ ] 新增路由文件时，同步创建 `tests/<route>.test.ts`，遵循 mock pool 模式，确保覆盖率不跌破 65%
- [ ] `git add -f` 强制提交 Task Card（每次 Stage 2 开始前确认 task card 已 force-add）
- [ ] CI 环境使用 Node 20 + npm 10.x；安全依赖版本应以 CI 环境为准，不以本地 npm 11.x 为准
- [ ] `lodash`、`axios` 等被传递依赖的包，需通过 `package.json overrides` + 直接依赖双重锁定版本
- [ ] 每次 push 前在 apps/api 目录本地跑 `npm ci && vitest run --coverage` 验证覆盖率（需先 `npm ci` 安装依赖）
