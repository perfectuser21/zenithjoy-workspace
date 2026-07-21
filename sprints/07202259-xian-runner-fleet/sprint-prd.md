# Sprint PRD：西安机群CI/RPA基础设施 — self-hosted runner 扩容+一键装/清脚本

TASK_ID: 910a5872-d749-4a86-964a-27407aafd734
SPRINT_DIR: sprints/07202259-xian-runner-fleet
JOURNEY_ID: 0c1f70f1-b061-4118-b741-8a31c1791c68

## Invariant 约束

- **安全**：GitHub PAT / Tailscale API Key / Cloudflare Token 不得硬编码进脚本，必须通过环境变量传入；脚本运行完毕后不得在日志中明文打印凭据
- **幂等**：部署脚本重复运行时，检测到 `C:\ZJRunnerFleet\installed.json` 已记录对应组件则直接跳过，不重复注册 runner、不重复认证 Tailscale
- **白名单清理**：清理脚本只清理 `installed.json` 白名单内的组件，不动历史手工机器（xian-rog 等）的任何残留
- **失败即退**：任何一步失败立即非零退出码，不吞异常、不降级为 warning
- **runner 常驻方式**：必须使用 autologon + 计划任务，禁止 `svc install` Windows Service（PR#1403 教训：Service 非交互 session 下 UIA 找不到窗口）
- **tenant 隔离**：机器管理 API 必须校验 X-Tenant-Id，无认证返回 401
- **DB 向后兼容**：`owner_type` 字段 DEFAULT 'customer'，现有机器记录不受影响

## 累积 FR

- FR-1（F1）：WARP 穿透 GFW + Tailscale ephemeral key 入网，一键装/清，幂等
- FR-2（F2）：GitHub self-hosted runner 自动注册（PAT 现领 token），autologon+计划任务常驻，标签 `[self-hosted,wechat-capable,windows]`
- FR-3（F3）：wechat-capable RPA 依赖环境自动安装（Python/uiautomation/pyautogui），带版本自检
- FR-4（F4）：幂等性验证（第二次跑全跳过）+ 故障标红验证（单步失败非零退出）
- FR-5（F5）：`agents` 表 `owner_type` 字段 + API 过滤 + 机器管理页双维度展示（内部机群/客户设备 tab × Windows/安卓 OS 类型区分）

## NFR

- 脚本每步骤输出清晰的进度提示（Step N/6: ...）
- 失败时打印具体错误原因，不仅是非零退出码
- 脚本可在 Windows PowerShell 5.1+（管理员权限）下运行
- API owner_type 过滤：非法值静默忽略（返回全量），不报错
- 机器管理页 tab 切换响应 < 500ms（纯客户端过滤，无额外 API 调用）

## Feature 清单

| Feature | id | thickness | step |
|---|---|---|---|
| 网络引导层(WARP+Tailscale)一键装/清 | 46dd04d7 | thin→thin | F1 |
| GitHub runner 自动注册+常驻 | bca572d4 | thin→thin | F2 |
| wechat-capable RPA依赖安装 | 3bd9c9b4 | thin→thin | F3 |
| 幂等性+故障标红 | 2cae1a07 | thin→thin | F4 |
| 设备清单管理双维度展示 | 8ebff409 | thin→thin | F5 |

## E2E 验收

Final E2E 脚本：`.github/workflows/scripts/smoke/xian-runner-fleet-smoke.sh`

CI 内可跑断言：
1. `GET /api/agent/machines`（带认证）返回 success=true，data 是数组
2. 每条 machine 记录包含 `owner_type` 字段
3. 每条 machine 记录包含 `os_type` 字段
4. 无认证 → 401（租户隔离回归）
5. GitHub PAT 可访问 runner API（权限验证）

不进 CI 的人工验收：新机器首次上线（物理接触不到裸机）

## 不在 scope

- 改动 `.github/workflows/*.yml` job 定义
- 机器白名单/审批层
- GitHub App installation token 迁移
- xian-rog 历史遗留清理

journey_type: dev_pipeline
target_environment: windows_wechat
