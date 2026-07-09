# Sprint PRD：ZenithJoy 员工工具中心（Staff Tools Hub）+ Skill Evaluator 上传页接入

sprint_dir: sprints/07090821-staff-tools-skill-eval
task_id: 23b96c28-cf91-4657-bd26-46cd33837f16
journey_id: 636a918c-8b23-4df5-baec-b1eb3308fffb
journey_name: ZenithJoy 运营中枢（Line 00）
feature_id: 16ac50db-bbc1-4b08-b922-97e251eb57f3
date: 2026-07-09

---

## 目标

在 ZenithJoy Dashboard 引入 `isStaff` 权限档位，新增「员工工具」侧边栏分组（可扩展脚手架），并将 Skill Evaluator 上传页作为第一个入驻工具。客户完全无感，只有白名单员工账号可见。

---

## Invariant 约束

（来源：CLAUDE.md + navigation.config.ts 现有模式）

1. **权限档位互不越权**：`isStaff` 与 `isSuperAdmin` 是独立检查，两者均为邮箱白名单 env var 驱动（`VITE_STAFF_EMAILS` / `VITE_SUPER_ADMIN_EMAILS`），集合关系未定义——staff 不自动含 superAdmin，反之亦然
2. **侧边栏配置驱动**：菜单项只通过 `navigation.config.ts` + `filterNavGroups` 控制，不得在侧边栏 JSX 里硬编码特定路由条目
3. **路由保护双层**：前端 `requireStaff` 守卫（Nav 过滤 + Route 守卫）+ 后端 `staffGuard` 中间件，二者都不能缺
4. **客户零感知**：不改动现有公开路由、不增加未登录可见的内容
5. **可扩展脚手架**：「员工工具」分组以 `requireStaff` 字段标记，新增内部工具只需在该分组 items 里加一条记录

---

## 累积 FR

（来自 PrepPRD 交接 + Journey Line 00 运营中枢背景）

- FR1：引入 `isStaff` 权限（`VITE_STAFF_EMAILS` env var，逗号分隔，空白名单=无员工）
- FR2：AuthContext 暴露 `isStaff: boolean`，与 `isSuperAdmin` 对称
- FR3：`NavItem` 新增 `requireStaff?: boolean` 字段；`filterNavGroups` 接受 `isStaff` 参数过滤
- FR4：`DynamicSidebar` 把 `isStaff` 传入 `filterNavGroups`
- FR5：`autopilotNavGroups` 新增「员工工具」分组（`requireStaff: true`），含「Skill 评测上传」条目（路径 `/staff/skill-eval`）
- FR6：`additionalRoutes` 新增 `/staff/skill-eval` 路由条目（`requireStaff: true`）
- FR7：`App.tsx` Route 守卫：`requireStaff` 路由 → 非 staff 跳回 `/`
- FR8：`SkillEvalPage.tsx` React 组件（参考 VideoRemakePipelinePage 模式）：上传 zip → POST `/api/staff/skill-eval/upload` → 轮询 `/api/staff/skill-eval/status/:jobId` → 展示报告
- FR9：后端 `staff` 中间件（`staffGuard`）：检查 `X-User-Email` 头是否在 `STAFF_EMAILS` 白名单，不在 → 403
- FR10：后端代理路由 `POST /api/staff/skill-eval/upload`（受 staffGuard 保护，转发到 HK 反代 9100 端口）
- FR11：后端代理路由 `GET /api/staff/skill-eval/status/:jobId`（受 staffGuard 保护，轮询转发）
- FR12：E2E smoke：curl 验证 staff 端点存在且未认证返回 403
- FR13：Playwright E2E：staff 账号登录→侧栏出现「员工工具」→点击「Skill 评测上传」→上传 zip→轮询到 completed→展示报告

---

## NFR

- N1：skill-eval 页面上传失败必须展示错误提示（不得永久转圈）
- N2：轮询超时（>60s 无 completed）展示「评测服务暂不可用」提示
- N3：后端代理超时 30s，返回 504 时前端展示友好错误
- N4：`STAFF_EMAILS` 未设置时 staffGuard 返回 403（不放行，不同于 dev 下 superAdminGuard 的 fallback 行为）

---

## Golden Path（验收流程）

1. 员工账号（在 `VITE_STAFF_EMAILS` 白名单）登录 → 左侧栏出现「员工工具」分组
2. 点击「Skill 评测上传」→ 进入 `/staff/skill-eval`
3. 选择本地 zip 包 → 点击上传 → 页面显示 job_id + 轮询进度
4. 系统完成评测 → 页面展示评测报告（分数 + 详情）
5. 非白名单账号访问 `/staff/skill-eval` → 被重定向回 `/`（前端守卫）
6. curl POST `/api/staff/skill-eval/upload` 不带 staff 邮箱头 → 返回 403（后端守卫）

---

## 涉及文件

| 文件 | 动作 |
|---|---|
| `apps/dashboard/src/contexts/AuthContext.tsx` | 新增 `isStaff` |
| `apps/dashboard/src/config/navigation.config.ts` | 新增 `requireStaff` 字段 + 员工工具分组 + 路由 |
| `apps/dashboard/src/components/DynamicSidebar.tsx` | 传 `isStaff` 给 filterNavGroups |
| `apps/dashboard/src/App.tsx` | 员工工具路由守卫 |
| `apps/dashboard/src/pages/SkillEvalPage.tsx` | 新建（上传+轮询+报告） |
| `apps/api/src/middleware/staff.ts` | 新建 staffGuard |
| `apps/api/src/routes/staff.ts` | 新建 staff proxy routes |
| `apps/api/src/app.ts` | 注册 staff router |
| `apps/dashboard/e2e/staff-skill-eval.spec.ts` | 新建 Playwright E2E |
| `.github/workflows/scripts/smoke/staff-skill-eval-smoke.sh` | 新建 API smoke |
| `.github/workflows/scripts/smoke-baseline.txt` | 追加棘轮条目 |

---

## 不包含

- 按工具分权限的细粒度矩阵
- 员工工具 UI 设计规范体系
- 员工白名单具体邮箱（env var 占位，用户自行配置）

---

journey_type: internal_ops
target_environment: windows_cloud
