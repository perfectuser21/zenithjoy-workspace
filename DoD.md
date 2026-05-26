contract_branch: cp-harness-propose-r2-85dcd538
workstream_index: 3
sprint_dir: sprints/zj-ops1-session-health

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Operator Dashboard Tab 1（8×4 状态矩阵 + is_operator 守卫）

**范围**: 新建 `apps/dashboard/src/pages/OperatorPage.tsx`（8 平台行 × 4 账号列状态矩阵，每格显示 在线/离线/未配置 + 上次同步时间，is_operator 权限守卫，"立即同步"按钮）；`apps/dashboard/src/config/navigation.config.ts` 注册 /operator 路由

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/dashboard/src/pages/OperatorPage.tsx 文件存在
- [ ] [ARTIFACT] OperatorPage.tsx 包含 8 个平台（抖音/快手/小红书/视频号/头条/微博/知乎/公众号）
- [ ] [ARTIFACT] OperatorPage.tsx 包含 4 账号列类型（MAIN/SUB_1/SUB_2/SUB_3）
- [ ] [ARTIFACT] navigation.config.ts 包含 /operator 路由注册

## BEHAVIOR 条目

- [ ] [BEHAVIOR] is_operator 权限守卫（email 匹配 xuxiao21xx@icloud.com）
- [ ] [BEHAVIOR] 未授权用户 redirect/403 处理
- [ ] [BEHAVIOR] 页面含"立即同步"按钮
- [ ] [BEHAVIOR] 状态三态显示（在线/离线/未配置）
- [ ] [BEHAVIOR] export default 可被路由加载
