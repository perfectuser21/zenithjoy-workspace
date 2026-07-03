contract_branch: cp-07040207-ws-cb6f30d9-ws1
sprint_dir: sprints/07032332-line02-account-role-unify

---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 角色数据模型统一 & 账号管理页加绑定机器列

**范围**: GET /api/agent/burner/sessions 加 agent_hostname/agent_nickname（LEFT JOIN）；AcquisitionAccountsPage 加"绑定机器"列（含单元格值断言）；删除 DouyinBurnerBindPage + AreaHubPage 链接清理；DB migration + 迁移脚本（dry-run + cutover 三值映射）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/agent-burner.ts` GET /sessions SQL 使用 LEFT JOIN 查询别名 `a.hostname AS agent_hostname, a.nickname AS agent_nickname, a.status AS agent_status`
- [ ] [ARTIFACT] `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx` BurnerSession 接口含 `agent_hostname` + `agent_nickname` + `agent_status`，表格含"绑定机器"列，单元格含 `data-testid="machine-hostname-cell"`，离线时含 `data-testid="machine-status-offline"`
- [ ] [ARTIFACT] `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx` 文件已物理删除
- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 无 `DouyinBurnerBind` + 无 `douyin-burner-bind` 路径引用
- [ ] [ARTIFACT] `apps/dashboard/src/pages/AreaHubPage.tsx` 移除 `/dashboard/douyin-burner-bind` 链接
- [ ] [ARTIFACT] `apps/dashboard/tests/p2-sprint-b1-ws5/douyin-burner-bind-page.test.tsx` 文件已物理删除
- [ ] [ARTIFACT] DB migration 文件 `apps/api/db/migrations/*_account_role_unify.sql` 存在，含 health→status 映射 SQL + 停写标记
- [ ] [ARTIFACT] `apps/api/scripts/account-role-migrate.js` 迁移脚本存在，支持 `--dry-run` 参数，含三值映射逻辑
- [ ] [ARTIFACT] `apps/dashboard/e2e/line02-account-role-unify.spec.ts` Playwright 测试存在，不含 `page.route(`，含 `machine-hostname-cell` 断言
- [ ] [ARTIFACT] `.github/workflows/e2e-line02-account-role-unify-windows.yml` workflow 文件存在，含 `windows-latest` runner
- [ ] [ARTIFACT] `sprints/07032332-line02-account-role-unify/e2e-verify.ps1` 存在，含 API server 启动（port 3000）+ Playwright 调用

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/agent/burner/sessions 响应 success=true 且 sessions 为数组
- [ ] [BEHAVIOR] 有 burner session 时，响应含 agent_hostname/agent_nickname/agent_status key（值可 null）、role=="burner"、account_label、status，且无裸 hostname/nickname key
- [ ] [BEHAVIOR] GET /api/agent/burner/sessions 响应中不出现裸 nickname key
- [ ] [BEHAVIOR] 多租户隔离：租户 B 的 GET /sessions 不返回租户 A 的数据
- [ ] [BEHAVIOR] 无鉴权请求（无 X-Tenant-Id + 无 session）返回 401
- [ ] [BEHAVIOR] 迁移脚本 --dry-run 退出码 0 并输出可读日志
- [ ] [BEHAVIOR] cutover 正式执行后，三值 health→status 映射写入 agent_platform_sessions（带时间窗防造假）

---

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] 管理员打开账号管理页，"绑定机器"列头可见，单元格渲染 hostname 或"—"（真实后端，无 stub）
