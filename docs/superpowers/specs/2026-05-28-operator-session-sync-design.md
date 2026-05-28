# Design: POST /api/operator/sessions/sync

Date: 2026-05-28  
Journey: ZenithJoy 运营中枢（Line 00, `636a918c`）  
Step: 运营面板状态矩阵（`8dc6c1fc`）  
Feature: Dashboard 运营中枢状态矩阵（`c85f9fac`, thin → done）

## Problem

`OperatorPage.tsx` 的「立即同步」按钮调用 `POST /api/operator/sessions/sync`，但该端点从未实现。矩阵永远全显「未配置」，运营面板功能性为零。

## Solution

新建 `apps/api/src/routes/operator.ts`，实现单一端点，读取 CI 已产出的 `session-health-report.json`，转换格式后返回给前端。

## Architecture

```
OperatorPage.tsx
  → POST /api/operator/sessions/sync
  → superAdminGuard（xuxiao21xx@icloud.com only）
  → 读 session-health-report.json（repo 根目录，check-health.js 产出）
  → 转换：35条 → 8×4 矩阵（API key 条目过滤掉）
  → 返回 {matrix: Record<Platform, Record<AccountType, {status, lastSync}>>}
```

## Data Mapping

`session-health-report.json` 格式（每条）：
```json
{ "platform": "抖音主号", "secretEnv": "DOUYIN_MAIN", "status": "ok", "checkedAt": "2026-05-28T01:00:00Z", "expiresAt": null }
```

矩阵 key 映射规则（从 `secretEnv` 解析）：

| secretEnv 前缀 | 矩阵 platform key |
|---|---|
| DOUYIN | 抖音 |
| KUAISHOU | 快手 |
| XIAOHONGSHU | 小红书 |
| SHIPINHAO | 视频号 |
| TOUTIAO | 头条 |
| WEIBO | 微博 |
| ZHIHU | 知乎 |
| GONGZHONGHAO | 公众号 |

账号类型：`secretEnv` 末尾 `_MAIN` → `MAIN`，`_SUB_1` → `SUB_1`，以此类推。

API key 条目（`FEISHU_API_KEY`、`NOTION_API_KEY`、`WECOM_API_KEY`）跳过，不进矩阵。

`lastSync`：`checkedAt` 格式化为 `YYYY-MM-DD HH:mm`（本地时间）。

## Error Handling

- `session-health-report.json` 不存在 → 返回 `{matrix: {}}` with HTTP 200（不报 500）
- 文件内容不是合法 JSON → 同上，记 console.warn
- `secretEnv` 格式不匹配任何已知前缀 → 跳过该条目（防 API key 等杂项污染矩阵）

## Files Changed

| 文件 | 变更 |
|---|---|
| `apps/api/src/routes/operator.ts` | 新建，实现路由 |
| `apps/api/src/routes/operator.test.ts` | 新建，集成测试 |
| `apps/api/src/app.ts` | +2 行：import + app.use |

## Testing Strategy

**Integration（重点）**：
- 正常路径：mock `session-health-report.json` 含 4 条不同平台记录 → 验证矩阵格式、status、lastSync 格式
- 文件缺失：`session-health-report.json` 不存在 → 200 + `{matrix: {}}`
- API key 过滤：含 `FEISHU_API_KEY` 条目 → 不出现在矩阵中
- 未授权：非 superAdmin 邮箱 → 403

**E2E（trivial，不单独写）**：依赖 CI 的 smoke 检查

## Acceptance Criteria

- [ ] `POST /api/operator/sessions/sync` 返回正确 8×4 矩阵格式
- [ ] `session-health-report.json` 缺失时返回 `{matrix: {}}` 而非 500
- [ ] API key 条目不污染矩阵
- [ ] 非 superAdmin 调用返回 403
- [ ] 测试全绿，CI 全绿
