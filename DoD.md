contract_branch: main
workstream_index: 3
sprint_dir: sprints/line00-session-health-medium

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard OperatorPage 重构（thin → medium）

**范围**: 重写 `apps/dashboard/src/pages/OperatorPage.tsx`：8 平台主号单列展示（非 4×4 矩阵）；status 枚举修正 ok→active；每行含「登录」按钮触发 POST trigger-bind；GET sessions 30s 轮询；lastCheckedAt/lastValidAt 时间显示；is_operator 守卫保留

## BEHAVIOR 条目

- [BEHAVIOR] OperatorPage.tsx 调用 GET /api/operator/sessions（非旧 /sync）
- [BEHAVIOR] status 枚举已修正为 active（禁用 ok）
- [BEHAVIOR] 含「登录」按钮并调用 POST /api/operator/sessions/trigger-bind
- [BEHAVIOR] 含轮询逻辑（setInterval，间隔 ≤30000ms）
- [BEHAVIOR] 含 lastCheckedAt 或 lastValidAt 字段显示
- [BEHAVIOR] is_operator 守卫保留 xuxiao21xx@icloud.com

## ARTIFACT 条目

- [ARTIFACT] apps/dashboard/src/pages/OperatorPage.tsx 存在且 export default
