## Notion Sync Hook: PR merge → Sprint/Component 自动 PATCH (2026-05-13)

**Branch**: `cp-0513214511-notion-sync-hook` → PR #291
**Brain task**: `c80af602-25a4-452c-80c2-86b5338f5990`

### 任务

让 PR merge 之后自动同步 Notion Sprint Registry (Status=done + PRs append) 与 Component Registry (Last Changed Sprint), 减少 Lead 手动维护 Notion 6 DB 架构的人工成本。

### 根本原因 (为什么之前没做)

Notion 6 DB 架构是本周才落地的, 之前没有 "PR merge 触发 Notion 更新" 这个集成需求。架构稳定后再补 hook 是正确顺序 (先有数据模型, 再有自动化), 不是技术债。

### 关键设计 (非显然)

1. **PR body trailer 触发 vs 总 trigger**
   - 拒绝方案: 所有 PR merge 都跑 + 在脚本里启发式判断
   - 选方案: PR body 显式写 `Notion-Sprint: <name>` 才触发
   - 原因: 大量 chore/docs PR 不需要碰 Notion, 静默 exit 0 不污染 Actions 日志

2. **永远 exit 0 铁律**
   - PR 已经 merge, hook 失败也无回退意义
   - 故意 swallow 所有 try/catch + main().finally(exit 0)
   - 避免 GitHub Actions 红色徽章污染历史

3. **Notion API field 类型必须先 query schema 再写代码**
   - `Status` 是 select (不是 status type, Notion 2022 schema 有区别)
   - `PRs` 是 rich_text (不是 url, 因为要 append 多个)
   - `Last Changed Sprint` 是 rich_text (不是 relation, 因为简化避免关系链管理)
   - 拍脑袋写会被 Notion API 400 validation_error 教做人

4. **ZenithJoy CI lint 对 `.github/` 改动豁免**
   - `lint-feature-has-smoke` / `lint-tdd-commit-order` / `lint-test-pairing` 都只看 `apps/*/src/`
   - 但 PR title 仍需要 `[CONFIG]` tag (ci-config-audit 检查)
   - 分支名仍需 `cp-\d{8,10}-...` 格式 (verify-dev-workflow 检查)

### 下次预防 (写类似 hook 的 checklist)

- [ ] 写代码前: `curl Notion /databases/<id>` 拿 schema, 不要拍脑袋字段类型
- [ ] 永远 try/catch + finally exit 0 (hook 后置, 不能阻塞主流程)
- [ ] PR body trailer 解析用 `^Notion-XXX:\s*(.+?)\s*$/m` (`^...$/m` 是 multiline 锚点)
- [ ] dry-run flag 是 smoke 真验证 + 不写副作用的必备出口
- [ ] secret 名约定: `<SERVICE>_API_KEY` 全大写下划线 (与 OPENROUTER_API_KEY / GITLEAKS_LICENSE 风格一致)
- [ ] `permissions: contents: read` 显式收窄, 不依赖 GitHub Actions 默认
- [ ] PR 自己加 trailer 自指 = 第一次 e2e 验证 (PR merge → workflow run → Notion 真出现自己)

### 后续加厚条件 (背书证据驱动)

- Step status 自动 done: Lead 自验脚本能输出 ✅/❌ 真证据后, hook 读结果再写 Step DB
- Component 自动建: 真出现 ≥5 次 "component not found" warning 后加 idempotent create
- Feature 同步: PR trailer 支持 `Notion-Features` 后
