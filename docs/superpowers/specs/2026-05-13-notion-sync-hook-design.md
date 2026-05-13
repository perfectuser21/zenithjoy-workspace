# Notion Sync Hook (PR Merge → Sprint/Component DB 自动更新)

**任务**: Brain task `c80af602-25a4-452c-80c2-86b5338f5990`
**分支**: `cp-0513214511-notion-sync-hook`
**Thickness**: thin
**Path 归属**: 跨 Path 基础设施 (减少手动维护 Notion 6 DB 的负担)
**日期**: 2026-05-13

---

## 1. 目标

PR merge 到 main 后, GitHub Actions 自动 PATCH Notion:
- **Sprint Registry DB**: 把对应 Sprint 行 `Status=done`, `PRs` 字段 append `PR#<n>` + URL
- **Component Registry DB**: 把命中 Component 的 `Last Changed Sprint` 字段更新为该 Sprint 名

避免 Lead 每次合 PR 后手动开 Notion 改字段。

## 2. 触发约定 (PR body trailer)

PR description 里加这种行 (任一缺失都不会让 hook 出错):

```
Notion-Sprint: Sprint 2.1f 产品级容错
Notion-Components: Agent 客户端, OpenRouter Client
```

- 缺 `Notion-Sprint:` → 静默 exit 0 (大量 chore/docs PR 不需要触发, 静默不污染日志)
- 缺 `Notion-Components:` → 只更新 Sprint, 不动 Component
- 行名找不到对应 Notion 行 → 打 warning, 继续走完, 最后 exit 0 (PR 已 merge, hook 永不能阻塞)

## 3. 架构

```
.github/workflows/notion-sync.yml          ← 触发器 (pull_request closed + merged)
└─ Node 20 runtime
   └─ .github/scripts/notion-sync-on-merge.js  ← 实现 (~120 行)
      └─ Notion REST API (https://api.notion.com/v1)
         ├─ POST /databases/<sprint_db>/query   ← 按 Name 找 sprint 行
         ├─ PATCH /pages/<sprint_id>            ← Status + PRs append
         ├─ POST /databases/<comp_db>/query     ← 按 Name 找 component 行
         └─ PATCH /pages/<comp_id>              ← Last Changed Sprint

.github/workflows/scripts/smoke/notion-sync-smoke.sh  ← 本地 + CI 真凭据 smoke
```

## 4. 组件 / 接口

### 4.1 notion-sync.yml (workflow)

```yaml
name: Notion Sync on PR Merge
on:
  pull_request:
    types: [closed]
    branches: [main]
permissions:
  contents: read
jobs:
  sync:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node .github/scripts/notion-sync-on-merge.js
        env:
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_URL: ${{ github.event.pull_request.html_url }}
```

### 4.2 notion-sync-on-merge.js (worker)

模块边界:
- `parseTrailers(prBody)` → `{ sprint: string|null, components: string[] }`
- `findPageByName(dbId, name)` → `pageId|null` (POST query w/ `filter.title.contains`)
- `patchSprintDone(pageId, prRef)` → 写 Status=done + PRs append
- `patchComponentLastSprint(pageId, sprintName)` → 写 Last Changed Sprint
- `main()` → orchestrate, 全程 try/catch, 最后总是 exit 0

`--dry-run` flag: 读 + 查不写, 只 log "would PATCH ..."。smoke 用。

依赖: Node 20 自带 `fetch`, 不引外部包。

### 4.3 notion-sync-smoke.sh (E2E)

3 个 case:
1. trailer + 真 sprint 名 → dry-run 输出 "found sprint" + "would PATCH"
2. 无 trailer → "no Notion-Sprint trailer" 日志 + exit 0
3. trailer 但 sprint 名不存在 → "sprint not found" warning + exit 0

跑法: `bash .github/workflows/scripts/smoke/notion-sync-smoke.sh` (本地需 `~/.credentials/notion.env`)。

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| 无 NOTION_API_KEY (CI 没配 secret) | warning + exit 0 |
| Notion API 5xx | log + 不重试 + exit 0 |
| trailer 解析失败 | log + exit 0 |
| Sprint 名歧义 (多行同名) | 取第一行, log warning |

**铁律**: hook 永远 exit 0。PR 已 merge, fail 也无回退意义, 只会污染 GitHub Actions 红色徽章。

## 6. 测试策略

| 行为 | 测试类型 | 文件 |
|---|---|---|
| PR body trailer 解析 (unit) | unit test 嵌入 smoke | smoke.sh case 1/2 |
| Notion 真 query 找 Sprint | E2E (真 Notion read) | smoke.sh case 1 |
| Notion 真 PATCH | **不测** (写操作有副作用, dry-run 已覆盖逻辑分支) | n/a |
| 找不到行不阻塞 | E2E | smoke.sh case 3 |

unit test 文件不单独建 (trivial wrapper, 解析逻辑全部在 smoke 真跑里覆盖)。

## 7. CI lint 兼容性

- `lint-feature-has-smoke`: 只查 `apps/*/src/`, 本 PR 不动 → 豁免
- `lint-tdd-commit-order`: 同上, 豁免
- `lint-test-pairing`: 同上, 豁免
- `[CONFIG]` PR title 前缀 → `ci-config-audit` 放行
- 分支名 `cp-0513214511-notion-sync-hook` → 10 位时间戳合规

## 8. 部署前置

**Lead 手动做** (一次性):
```bash
gh secret set NOTION_API_KEY --repo perfectuser21/zenithjoy-workspace
# 粘贴 ~/.credentials/notion.env 里的值
```

## 9. 上线后验证

PR 合并后第一次:
1. 看 GitHub Actions tab → notion-sync workflow run 是否成功
2. 开本 PR 自己的 body 加 trailer `Notion-Sprint: Sprint 2.1f 产品级容错` (随便一个 done sprint), merge 后看 Notion 该行 PRs 字段是否多了 `#<本 PR 号>`
3. 开 dummy PR (无 trailer) 看 workflow 是否静默 success

## 10. Out of Scope

- 不做 Step 状态自动 done (Step done 与否要 Lead 自验决定, 不能 PR merge 就 done)
- 不做 Component 创建 (找不到就 warning, 不自动建)
- 不做 Feature 字段更新 (thin 阶段先 Sprint + Component)
- 不做 retry / queue (3 秒超时, 失败不补)
- 不支持私有 fork PR (secrets 不暴露给 fork, 这是 GitHub 设计)

## 11. 后续加厚 (背书证据驱动)

- Step status 自动 done: 等 Lead 自验脚本能跑出 ✅/❌ 真证据时, hook 读 Lead 自验结果再写 Step
- Component 自动建: 等出现 ≥5 次 "component not found" warning 后, 加 idempotent create
- Feature 同步: 等 PR trailer 支持 Notion-Features 后

## 12. 风险

- **PR body 编辑后再 merge**: GitHub merge event 携带的是 merge 时刻 body, OK
- **同名 Sprint**: log warning 取第一, 不阻塞
- **Notion rate limit**: 单 PR 最多 ~10 次 API call, 远低于 3 req/sec 限制
