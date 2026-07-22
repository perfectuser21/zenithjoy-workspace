# Contract: 西安机群CI/RPA基础设施 — self-hosted runner 扩容

TASK_ID: 910a5872-d749-4a86-964a-27407aafd734
SPRINT_DIR: sprints/07202259-xian-runner-fleet
JOURNEY_ID: 0c1f70f1-b061-4118-b741-8a31c1791c68

## Feature 列表与验收断言

### F1：网络引导层 (id=46dd04d7)
- 一键部署脚本 `scripts/runner-fleet/deploy-runner.ps1` 存在且内容 ≥ 50 行实质逻辑
- 脚本包含 WARP 安装/检测逻辑（幂等：已装则跳过）
- 脚本包含 Tailscale 安装 + ephemeral auth key 申领逻辑
- WARP 和 Tailscale 共存段包含 DERP-exclude 说明注释（防二次踩坑）

### F2：GitHub runner 自动注册+常驻 (id=bca572d4)
- 脚本调 `POST /repos/{owner}/{repo}/actions/runners/registration-token` 现领 token（不硬编码）
- 注册时打标签 `self-hosted,wechat-capable,windows`
- 常驻使用 autologon + 计划任务模式（不使用 `svc install` Windows Service）
- runner 名格式为 `${hostname}-${random6char}`，保证唯一性

### F3：RPA 环境安装 (id=3bd9c9b4)
- 脚本自检关键依赖版本（Python/pip/uiautomation/pyautogui）
- 依赖清单文件 `scripts/runner-fleet/rpa-deps.txt` 存在

### F4：幂等性 + 故障标红 (id=2cae1a07)
- 脚本每步骤成功后在 `C:\ZJRunnerFleet\installed.json` 写入已完成组件清单
- 幂等验证 smoke：重复执行检测到清单文件时全步骤显示 skip，exit 0
- 故障验证：已知失败路径（伪造 API key）返回非零 exit code

### F5：机器管理页双维度展示 (id=8ebff409)
- `agents` 表新增 `owner_type TEXT CHECK(owner_type IN ('internal_fleet','customer')) DEFAULT 'customer'`
- API `GET /api/agent/machines` 返回字段包含 `owner_type`
- 前端 `MachineManagementPage` 列表有两个 tab：「内部机群」 / 「客户设备」
- OS 维度：android 机器展示 `📱 安卓`，win32 展示 `🖥 Windows`，区分不合并
- 机器列表 DB smoke 能查到 `owner_type` 字段

## Final E2E（CI 内可跑）

```
.github/workflows/scripts/smoke/xian-runner-fleet-smoke.sh
```

断言（按顺序，全部通过才算 PASS）：
1. `GET /api/agent/machines`（带认证）返回 success=true，data 是数组
2. 每条 machine 记录包含 `owner_type` 字段（'internal_fleet' 或 'customer'）
3. 每条 machine 记录包含 `os_type` 字段（可以为 null）
4. 无认证 → 401（租户隔离回归守卫）
5. `GET /repos/{owner}/{repo}/actions/runners` 用 PAT 可访问（验证 PAT 权限满足注册需求）

## 不在本 Contract 内
- 真实 runner 首次上线（物理接触不到裸机，人工验收）
- CI workflow 文件改动（不需要，新 runner 复用已有标签）
- xian-rog 历史遗留清理
