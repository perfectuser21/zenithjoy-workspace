# Contract Draft: 西安机群CI/RPA基础设施 — self-hosted runner 扩容+一键装/清脚本

TASK_ID: 910a5872-d749-4a86-964a-27407aafd734
SPRINT_DIR: sprints/07202259-xian-runner-fleet
JOURNEY_ID: 0c1f70f1-b061-4118-b741-8a31c1791c68
GAN_ROUND: 1（首轮，无 reviewer feedback）

---

## 判定点登记表（Architectural Decision Record）

| 判定点 | 决策 | 依据 |
|---|---|---|
| WARP 主代理 | WARP（Cloudflare WARP for Teams） | decision e035dad8：穿透 GFW 最稳定方案 |
| runner 常驻方式 | autologon + 计划任务（Task Scheduler） | PR#1403 教训：Windows Service 在非交互 session 下 UIA 找不到窗口 |
| 清理脚本白名单 | 只清 `installed.json` 记录的组件 | 不动 xian-rog 等历史手工机器的任何残留 |
| Tailscale key 策略 | ephemeral，现领现用，不持久化 | 泄漏后自动失效，最小权限原则 |
| RPA 服务帐号 | 计划任务以当前登录用户身份运行 | 与 UIA 窗口同 session，避免 Service 非交互坑 |

---

## Invariant 约束（不可违反）

1. **安全**：GitHub PAT / Tailscale API Key / Cloudflare Token 不得硬编码进脚本，必须通过环境变量传入；脚本运行完毕后不得在日志中明文打印凭据
2. **幂等**：部署脚本重复运行时，检测到 `C:\ZJRunnerFleet\installed.json` 已记录对应组件则直接跳过，不重复注册 runner、不重复认证 Tailscale
3. **白名单清理**：清理脚本只清理 `installed.json` 白名单内的组件，不动历史手工机器（xian-rog 等）的任何残留
4. **失败即退**：任何一步失败立即非零退出码，不吞异常、不降级为 warning
5. **runner 常驻方式**：必须使用 autologon + 计划任务，禁止 `svc install` Windows Service
6. **tenant 隔离**：机器管理 API 必须校验 X-Tenant-Id，无认证返回 401
7. **DB 向后兼容**：`owner_type` 字段 DEFAULT 'customer'，现有机器记录不受影响

---

## Feature 列表与验收断言

### F1：网络引导层 WARP+Tailscale 一键装/清（id=46dd04d7，thin→thin）

**可验证断言：**
- 一键部署脚本 `scripts/runner-fleet/deploy-runner.ps1` 存在且内容 ≥ 50 行实质逻辑（不含空行/注释）
- 脚本包含 WARP 安装/检测逻辑：已装（`warp-cli status` 返回 Connected）则打印 skip 跳过，不重复安装
- 脚本包含 Tailscale 安装 + ephemeral auth key 申领逻辑（key 从环境变量 `$env:TS_AUTH_KEY` 读取，不硬编码）
- WARP 和 Tailscale 共存段包含 DERP-exclude 注释（防止两者路由冲突二次踩坑）
- 清理脚本 `scripts/runner-fleet/cleanup-runner.ps1` 存在，且只卸载 `installed.json` 中记录的组件
- GitHub PAT / Tailscale API Key / Cloudflare Token 环境变量名在脚本中有明确说明，值不出现在任何 `Write-Host` / `echo` 输出里

### F2：GitHub runner 自动注册+常驻（id=bca572d4，thin→thin）

**可验证断言：**
- 脚本调 `POST /repos/{owner}/{repo}/actions/runners/registration-token` 现领 token（不硬编码 token 值）
- 注册时标签包含 `self-hosted,wechat-capable,windows`（三个标签缺一不可）
- 常驻使用 autologon + 计划任务模式，脚本中无 `.\svc.exe install` 字样
- runner 名格式为 `${hostname}-${random6char}`，保证跨机器唯一性
- 计划任务触发器为"登录时"（AtLogon），不是"系统启动时"（AtStartup），确保交互 session

### F3：wechat-capable RPA 依赖安装（id=3bd9c9b4，thin→thin）

**可验证断言：**
- 脚本自检关键依赖版本：Python（≥3.9）、pip、uiautomation、pyautogui — 各依赖版本检测结果打印到 stdout
- 依赖清单文件 `scripts/runner-fleet/rpa-deps.txt` 存在，包含 uiautomation 和 pyautogui 条目
- 安装步骤在 `installed.json` 中写入 `"rpa_deps": true` 标记，重复执行时读到该标记即跳过

### F4：幂等性 + 故障标红（id=2cae1a07，thin→thin）

**可验证断言：**
- 脚本每步骤成功后在 `C:\ZJRunnerFleet\installed.json` 写入已完成组件清单（JSON 格式，含时间戳）
- 幂等验证路径：当 `installed.json` 存在且所有组件已记录时，全步骤输出 `[SKIP]` 前缀并以 exit 0 结束
- 故障标红路径：伪造 API key（TS_AUTH_KEY=invalid）时，Tailscale auth 步骤返回非零 exit code，且错误原因打印到 stderr
- 每步骤输出格式 `Step N/6: <描述>` — NFR 要求

### F5：机器管理页双维度展示（id=8ebff409，thin→thin）

**可验证断言：**
- `agents` 表新增字段 `owner_type TEXT CHECK(owner_type IN ('internal_fleet','customer')) DEFAULT 'customer'`（迁移文件存在）
- DB migration 向后兼容：现有 agent 记录 `owner_type` 默认填充 'customer'，不为 null
- API `GET /api/agent/machines`（带 X-Tenant-Id）返回 `success: true`，data 数组中每条记录包含 `owner_type` 字段
- API `GET /api/agent/machines`（无 X-Tenant-Id）返回 401
- API `GET /api/agent/machines?owner_type=invalid_value` 静默忽略过滤，返回全量（不报错）
- 前端 `MachineManagementPage` 存在两个 tab：「内部机群」（filter: internal_fleet）和「客户设备」（filter: customer）
- OS 维度：android 机器展示 `📱 安卓`，win32 机器展示 `🖥 Windows`，两类不合并为同一展示
- 前端 tab 切换为纯客户端过滤（无额外 API 调用），响应 < 500ms

---

## Final E2E（CI 内可跑）

脚本路径：`.github/workflows/scripts/smoke/xian-runner-fleet-smoke.sh`

断言顺序（全部通过才算 PASS）：

```bash
# 1. API 可访问性 + 基本结构
curl -s -H "X-Tenant-Id: $TENANT_ID" -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/agent/machines" | jq -e '.success == true and (.data | type) == "array"'

# 2. owner_type 字段存在（所有记录）
curl -s -H "X-Tenant-Id: $TENANT_ID" -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/agent/machines" | jq -e '[.data[] | .owner_type] | all(. != null)'

# 3. os_type 字段存在（字段存在，值可为 null）
curl -s -H "X-Tenant-Id: $TENANT_ID" -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE/api/agent/machines" | jq -e '.data[] | has("os_type")' | grep -q true

# 4. 无认证 → 401
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/agent/machines")
[ "$STATUS" = "401" ]

# 5. GitHub PAT 可访问 runners API（验证 PAT 权限满足注册需求）
curl -s -H "Authorization: Bearer $GH_PAT" \
  "https://api.github.com/repos/$GH_OWNER/$GH_REPO/actions/runners" | jq -e '.runners != null'
```

---

## 未覆盖真实链路清单

以下场景不进 CI E2E，需人工验收或有等价 API 断言替代：

| 场景 | 原因 | CI 等价断言 |
|---|---|---|
| 新机器物理首次上线 | 裸机在防火墙内，CI 无法 SSH 触达，需人工现场执行 | 无（纯人工，文档化） |
| deploy-runner.ps1 的 WARP/Tailscale 真实安装 | 须在真实 Windows 机执行，CI 无 Windows RPA 环境 | Final E2E 第5条：PAT 可访问 runners API（证明脚本逻辑基本正确） |
| autologon + 计划任务真实注册 | Windows 注册表/Task Scheduler 操作，CI sandbox 无法验证 | Final E2E 第1-3条：runner 注册后 API 能看到 machine 记录（等价断言） |

---

## 不在本 Contract 内

- 改动 `.github/workflows/*.yml` job 定义（新 runner 复用已有标签，无需改 CI workflow）
- 机器白名单/审批层
- GitHub App installation token 迁移
- xian-rog 历史遗留清理
- 多租户 runner 隔离（当前 scope：单租户）
