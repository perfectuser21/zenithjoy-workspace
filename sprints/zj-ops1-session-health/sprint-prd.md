# Sprint PRD — ZenithJoy 运营中枢：Session 全平台健康管理（Tab 1）

## OKR 对齐

- **对应 KR**：KR-OPS1（运营自动化基础设施）
- **当前进度**：~15%（抖音单平台 thin 已有，其余空白）
- **本次推进预期**：~60%

## 背景

PR #453 上线了抖音单平台 Session 管理（check-health.js + sync 脚本 + Bark 告警），但仅覆盖 1 个平台 2 个账号。运营员实际管理 8 平台 × 4 账号，没有统一视图，掉线仅有 Bark 单渠道告警，Windows 同步仍需手动触发，CI E2E 拿 cookies 无标准路径。本 Sprint 将 Session 管理从抖音单平台 thin 扩展到 8 平台全覆盖 medium，并建立 Operator Dashboard Tab 1。

## Golden Path（核心场景）

**运营日常巡检路径**（入口 → 步骤 → 出口）：

1. **入口**：运营员（xuxiao21xx@icloud.com）打开 `/operator` 页面
2. 看到 8 平台 × 4 账号（MAIN / SUB_1 / SUB_2 / SUB_3）状态矩阵，每格显示 在线🟢 / 离线🔴 / 未配置⚫ + 上次同步时间
3. 任意账号掉线时：**Bark + 飞书机器人同时推送**（飞书超时 3s 后 log+continue，不阻塞 Bark）
4. xian-pc 开机后，Windows 计划任务每 2 小时自动 SSH 同步 8 平台 × 4 账号 Secrets 到 GitHub
5. 视频号（易掉平台）每 45 分钟心跳维稳；其他 7 平台每 4 小时维稳；视频号心跳失败自动触发重新同步
6. **出口**：CI Windows runner 通过 GitHub Secrets 自动获取 cookies，无需人工扫码

---

**WS1 — check-health.js 扩展路径**：

`node scripts/sessions/check-health.js` → 遍历 8×4=32 个平台账号 + 3 个 API key → 逐项验证 cookie 过期时间 + HTTP 健康检查 → 写 `session-health-report.json` → 通过 Bark + 飞书双渠道推送告警

**WS2 — sync 脚本扩展路径**：

`bash scripts/sessions/sync-from-xian-rog.sh` → SSH 到 xian-pc → 循环读取 8 平台 × `{default.json, burner/sub_1.json, sub_2.json, sub_3.json}` → `gh secret set` → 失败时保留上次 Secret 不覆盖 + Bark 推送告警

**WS3 — Operator Dashboard 路径**：

is_operator 守卫 → `/operator` 页面展示 8×4 状态矩阵 → 点"立即同步"按钮手动触发一次同步

**WS4 — CI 路径**：

`session-health-check.yml` 注入 35 个新 Secrets（32 平台 + 3 API key + FEISHU_BOT_WEBHOOK）→ ubuntu-latest 跑 check-health.js → 上传 artifact

## Response Schema

### WS1 输出：session-health-report.json（JSON array）

每项结构：
```json
{
  "platform": "抖音主号",
  "secretEnv": "DOUYIN_MAIN",
  "status": "ok",
  "checkedAt": "2026-05-26T10:00:00Z",
  "expiresAt": "2026-07-01T00:00:00Z"
}
```

字段约束：
- `status` 枚举：`ok` / `expired` / `invalid` / `missing`，**禁用** `healthy`/`good`/`bad`/`error`/`fail`
- `platform`：人类可读标签（如"快手主号"），**禁用** key 名 `name`/`label`/`account`
- `secretEnv`：对应 GitHub Secret 名（如 `KUAISHOU_MAIN`），**禁用** key 名 `secret`/`key`/`env`
- API key 检查项（飞书/Notion/企微）：`expiresAt` 写 `null`
- 顶层 keys 完全等于 `["platform", "secretEnv", "status", "checkedAt", "expiresAt"]`，不允许多余字段

WS2/WS4 无 HTTP 响应（本地脚本 / CI YAML 改动），Response Schema 为 N/A。

WS3 Dashboard 读取健康数据来源由 Generator 决定（可从 CI artifact API 或后端定时拉取）。

## 边界情况

- SSH 不通时：`sync_one` 标记 failed → 保留 GitHub Secret 上次有效值不覆盖 → Bark 推送"同步失败"，不静默失败
- 飞书 webhook 超时（>3s）：try/catch 包裹，log + continue，Bark 告警正常发出
- GitHub Secret 未配置（值为空）：健康检查标记 `status: "missing"`，不报 `expired`
- 视频号心跳任务失败：XML `OnFailure` 动作触发 sync 任务重新同步
- `SKIP_HTTP_CHECK=true`：跳过所有网络请求，仅做 cookie 格式 + 过期时间校验（CI E2E 离线环境用）
- 运营员以外的用户访问 `/operator`：重定向到首页或 403

## 范围限定

**在范围内**：
- 8 个平台：抖音 / 快手 / 小红书 / 视频号 / 头条 / 微博 / 知乎 / 公众号
- 每平台 4 个账号：MAIN / SUB_1 / SUB_2 / SUB_3（共 32 个 Secrets）
- 3 个 API key Secrets：FEISHU_API_KEY / NOTION_API_KEY / WECOM_API_KEY
- 飞书机器人双渠道告警（补充现有 Bark）
- Windows 计划任务 XML（2hr sync + 45min 视频号心跳 + 4hr 其他平台心跳）
- Operator Dashboard Tab 1（is_operator 权限守卫）
- CI session-health-check.yml 注入全部新 Secrets

**不在范围内**：
- B 站（架构预留，本次不实现任何 B 站逻辑）
- 客户管理 Tab 2
- 自动重新登录（掉线仍需人工扫码，本 Sprint 只负责"检测 + 告警"）
- 新增登录 UI 流程

## 假设

- [ASSUMPTION: 任务描述提到"9大平台"，PrepPRD 实际定义 8 个平台（B站排除），以 PrepPRD 为准]
- [ASSUMPTION: Operator Dashboard 健康状态数据来源由 Generator 设计，可以是 CI artifact 下载或后端 `/api/sessions/health` 端点]
- [ASSUMPTION: is_operator 权限通过 user.email === "xuxiao21xx@icloud.com" 匹配，与现有 requireSuperAdmin 机制平行]
- [ASSUMPTION: windows-task-scheduler.xml OnFailure trigger 使用 Windows 任务调度器原生 XML 方案，不依赖第三方工具]
- [ASSUMPTION: xian-pc SSH 别名与现有 sync 脚本中的 xian-rog 同等可达，用 `${MACHINE:-xian-pc}` 参数传入]

## Risks（GAN 强制要求）

- **R1 飞书 webhook 超时**：sendFeishuAlert() 必须用 Promise.race + 3s timeout 包裹，catch 内 console.warn + return，不抛出，不阻塞 Bark 告警链路
- **R2 SSH 不通时 sync 失败**：sync_one 失败时不调用 `gh secret set`（保留上次有效值），push Bark 告警"同步失败"，failed 数组记录，最终汇报失败数，不静默退出

## 预期受影响文件

- `scripts/sessions/check-health.js`：PLATFORMS 扩展到 8×4 条目 + sendFeishuAlert() 新增 + SKIP_HTTP_CHECK 支持
- `scripts/sessions/sync-from-xian-rog.sh`：sync_matrix 循环重构，覆盖 8 平台 × MAIN+SUB_1/2/3
- `scripts/sessions/windows-task-scheduler.xml`：新建，含 3 种计划任务 + OnFailure trigger
- `apps/dashboard/src/pages/OperatorPage.tsx`：新建，8×4 状态矩阵 + is_operator 守卫
- `apps/dashboard/src/config/navigation.config.ts`：注册 /operator 路由（is_operator 权限）
- `.github/workflows/session-health-check.yml`：env 段新增 35 个 Secrets + FEISHU_BOT_WEBHOOK
- `.github/workflows/scripts/smoke/session-health-smoke.sh`：新建验收 smoke 脚本
- `sprints/zj-ops1-session-health/e2e-verify.ps1`：新建 Windows E2E 入口脚本

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/src/pages/OperatorPage.tsx，核心路径从运营员打开 /operator 页面开始
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E → GitHub Actions windows-latest runner，通过 e2e-windows.yml 触发执行 sprints/zj-ops1-session-health/e2e-verify.ps1
