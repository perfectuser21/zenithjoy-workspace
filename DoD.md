contract_branch: main
workstream_index: 4
sprint_dir: sprints/zj2-smart-acquisition-run1

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: GET /api/acquisition/leads + LeadsPage.tsx + navigation

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `GET /leads` endpoint（读飞书 Leads 表，支持 grade 筛选）
- `apps/dashboard/src/pages/LeadsPage.tsx`：新建 Leads 列表页（等级标签表格）
- `apps/dashboard/src/config/navigation.config.ts`：注册 `/dashboard/leads` 路由入口

**大小**: M（100-200 行，3 文件）
**依赖**: Workstream 3（GET leads 读取飞书写入的带 grade/keyword 字段数据）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/LeadsPage.tsx` 文件存在且包含 `leads-table` data-testid
- [ ] [ARTIFACT] `navigation.config.ts` 包含 `/dashboard/leads` 路由入口
- [ ] [ARTIFACT] `acquisition.ts` 包含 `GET` + `leads` 路由定义

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/acquisition/leads 返回 HTTP 200，顶层 keys 精确等于 `["leads","total"]`
- [ ] [BEHAVIOR] `leads` 为数组，`total` 为数字
- [ ] [BEHAVIOR] lead item 6 字段完整性：commenter_id/comment_text/source_video_url/crawled_at/grade/keyword
- [ ] [BEHAVIOR] 禁用字段 data/items/records/rows/result 不在顶层
- [ ] [BEHAVIOR] grade 筛选生效（grade=高意向 → 所有结果 grade='高意向'）
- [ ] [BEHAVIOR] grade 非法值 → 400 + error='INVALID_GRADE'
- [ ] [BEHAVIOR] 飞书 token 过期 → 503 + error='FEISHU_TOKEN_EXPIRED'
- [ ] [BEHAVIOR:E2E] /dashboard/leads 页面可见，Playwright 截图显示 leads-table 和 grade-badge
