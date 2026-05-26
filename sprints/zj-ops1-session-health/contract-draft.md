# Sprint Contract Draft (Round 1)

**Sprint**: ZenithJoy 运营中枢 — Session 全平台健康管理（Tab 1）
**journey_type**: user_facing
**target_environment**: windows_cloud
**Proposer**: harness-contract-proposer v7.12.0

---

## Golden Path

[健康检查触发] → [告警双推] → [自动同步] → [维稳心跳配置] → [Operator面板查看] → [Smoke验收]

---

### Step 1: 健康检查触发 — CI 运行 check-health.js 覆盖 8 大平台 + 3 API key

**来源**: `[FROM_PRD]` — PRD Golden Path 第1步："每天 4 次（00/06/12/18 时）CI job 运行 check-health.js，对 9 大平台各账号发起 HTTP 登录验证"

> ⚠️ **PRD 数量说明**: PRD 声明"9 大平台"，但明确列出的平台为 7 个新增（快手/小红书/视频号/头条/微博/知乎/公众号）+ 抖音已有 = 8 个。本合同以 8 个可命名平台为准，Reviewer 可在 GAN 轮次中裁定第 9 个平台。

**可观测行为**: GitHub Actions CI（ubuntu-latest）在北京时间 00/06/12/18 时运行 `scripts/sessions/check-health.js`，脚本对 8 大平台（DOUYIN/KUAISHOU/XIAOHONGSHU/SHIPINHAO/TOUTIAO/WEIBO/ZHIHU/WECHAT）各账号（MAIN/SUB_1/2/3）发起 HTTP 登录检查，输出 `session-health-report.json`（含每个平台的 status/reason/checkedAt 字段）

**验证命令**:
```bash
# 验证 PLATFORMS 数组包含所有新增平台 Secret env var
node -e "
const code = require('fs').readFileSync('scripts/sessions/check-health.js', 'utf8');
const platforms = ['KUAISHOU', 'XIAOHONGSHU', 'SHIPINHAO', 'TOUTIAO', 'WEIBO', 'ZHIHU', 'WECHAT'];
const missing = platforms.filter(p => !code.includes(p));
if (missing.length > 0) { console.error('FAIL: 缺少平台', missing); process.exit(1); }
console.log('OK: 所有新增平台已配置');
"
```

**硬阈值**: check-health.js 中 `PLATFORMS` 数组包含至少 7 个新增平台 Secret env var 引用

---

### Step 2: 告警双推 — session 失效时 Bark + 飞书 webhook 同步推送

**来源**: `[FROM_PRD]` — PRD Golden Path 第2步："Bark 推送手机 + 飞书机器人 webhook 同步推送告警消息（https://open.feishu.cn/open-apis/bot/v2/hook/5bde68e0-9879-4a45-88ed-461a88229136）"

**可观测行为**: 任一平台 session 过期/HTTP 检查失败时，脚本并行调用 `BARK_URL` 和 `FEISHU_BOT_WEBHOOK`；飞书 payload 符合飞书机器人 v2 API 格式（`{"msg_type":"text","content":{"text":"..."}}` 或 interactive card）

**验证命令**:
```bash
node -e "
const code = require('fs').readFileSync('scripts/sessions/check-health.js', 'utf8');
if (!code.includes('FEISHU_BOT_WEBHOOK')) {
  console.error('FAIL: 缺少 FEISHU_BOT_WEBHOOK env var 引用');
  process.exit(1);
}
if (!code.includes('open.feishu.cn') && !code.includes('feishu')) {
  console.error('FAIL: 缺少飞书 webhook 发送逻辑');
  process.exit(1);
}
if (!code.includes('sendFeishuAlert') && !code.includes('feishuNotify')) {
  console.error('FAIL: 缺少飞书告警函数');
  process.exit(1);
}
console.log('OK: 飞书双推逻辑存在');
"
```

**硬阈值**: Bark + 飞书 webhook 双路告警代码同时存在；飞书 payload 包含 `msg_type` 字段

---

### Step 3: 自动同步 — Windows 计划任务每 2 小时触发，36 Secrets 全覆盖

**来源**: `[FROM_PRD]` — PRD Golden Path 第3步："xian-pc Windows 计划任务每 2 小时从 `C:\Users\asus\.zenithjoy-agent\sessions\` 读取...通过 SSH + gh CLI 推送到 GitHub Secrets（36 个 Secret：DOUYIN_MAIN / DOUYIN_SUB_1 / DOUYIN_SUB_2 / DOUYIN_SUB_3，其余 8 平台同规范）"

**可观测行为**: `sync-from-xian-rog.sh` 包含所有 8 平台 × MAIN/SUB_1/2/3 的 `sync_one` 调用（至少 MAIN 层）；`windows-task-scheduler.xml` 新建，含每 2 小时触发器，调用 sync 脚本

**验证命令**:
```bash
node -e "
const sync = require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh', 'utf8');
const platforms = ['KUAISHOU_MAIN', 'XIAOHONGSHU_MAIN', 'SHIPINHAO_MAIN', 'TOUTIAO_MAIN', 'WEIBO_MAIN', 'ZHIHU_MAIN', 'WECHAT_MAIN'];
const missing = platforms.filter(p => !sync.includes(p));
if (missing.length > 0) { console.error('FAIL: sync 脚本缺少', missing); process.exit(1); }
console.log('OK: sync 脚本含新平台 Secret 引用');
"
node -e "require('fs').accessSync('scripts/sessions/windows-task-scheduler.xml'); console.log('OK: task scheduler XML 存在')" || { echo "FAIL: windows-task-scheduler.xml 不存在"; exit 1; }
node -e "
const xml = require('fs').readFileSync('scripts/sessions/windows-task-scheduler.xml', 'utf8');
if (!xml.includes('PT2H') && !xml.includes('120') && !xml.includes('2Hour')) {
  console.error('FAIL: XML 缺少 2 小时触发器');
  process.exit(1);
}
console.log('OK: 2 小时触发器已配置');
"
```

**硬阈值**: sync 脚本含 7 个新平台 MAIN Secret 引用；XML 文件存在且含 2 小时间隔触发器

---

### Step 4: 维稳心跳任务配置 — 视频号 45min / 其他 8 平台 4hr

**来源**: `[FROM_PRD]` — PRD Golden Path 第4步："Agent 对视频号（SHIPINHAO）等高挥发平台每 45 分钟执行一次 CDP 模拟活动保持在线；其他 8 平台每 4 小时一次"

**可观测行为**: `windows-task-scheduler.xml` 包含视频号 45 分钟心跳触发器和其他平台 4 小时心跳触发器；掉线后触发重新同步（XML 任务逻辑或独立脚本调用）

**验证命令**:
```bash
node -e "
const xml = require('fs').readFileSync('scripts/sessions/windows-task-scheduler.xml', 'utf8');
// 检查 45 分钟间隔（ISO 8601 PT45M 或 XML 格式 00:45:00）
if (!xml.includes('PT45M') && !xml.includes('00:45:00') && !xml.includes('45m') && !xml.includes('Minute>45')) {
  console.error('FAIL: 缺少视频号 45 分钟心跳配置');
  process.exit(1);
}
// 检查 4 小时间隔（PT4H 或 00:04:00 或 04:00:00）
if (!xml.includes('PT4H') && !xml.includes('04:00:00') && !xml.includes('Hour>4')) {
  console.error('FAIL: 缺少其他平台 4 小时心跳配置');
  process.exit(1);
}
if (!xml.includes('SHIPINHAO') && !xml.includes('shipinhao') && !xml.includes('视频号')) {
  console.error('FAIL: XML 未特别标注视频号心跳任务');
  process.exit(1);
}
console.log('OK: 心跳间隔配置正确');
"
```

**硬阈值**: XML 含视频号 45 分钟间隔 + 其他平台 4 小时间隔的独立心跳任务定义

---

### Step 5: Operator 面板查看 — /operator 路由 + Session Health Dashboard

**来源**: `[FROM_PRD]` — PRD Golden Path 第5步："is_operator 用户（xuxiao21xx@icloud.com）访问 `/operator` 路由，看到状态灯（🟢在线 / 🔴离线 / ⚫未配置）、上次同步时间、一键手动触发同步按钮"

**可观测行为**: `OperatorPage.tsx` 存在，含 is_operator 权限判断（非 operator 用户重定向或显示无权限）；显示 8 平台 × 4 账号状态矩阵；`navigation.config.ts` 注册 `/operator` 路由

**验证命令**:
```bash
node -e "
require('fs').accessSync('apps/dashboard/src/pages/OperatorPage.tsx');
const code = require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx', 'utf8');
if (!code.includes('xuxiao21xx@icloud.com') && !code.includes('is_operator') && !code.includes('isOperator')) {
  console.error('FAIL: OperatorPage 缺少 operator 权限判断');
  process.exit(1);
}
console.log('OK: OperatorPage 含权限判断');
"
node -e "
const nav = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!nav.includes('/operator')) {
  console.error('FAIL: navigation.config 缺 /operator 路由注册');
  process.exit(1);
}
console.log('OK: /operator 路由已注册');
"
```

**硬阈值**: OperatorPage.tsx 存在且含权限判断逻辑；`/operator` 在 navigation.config.ts 中已注册

---

### Step 6: Smoke 验收 — session-health-smoke.sh 端到端验证 + CI workflow 36 Secrets

**来源**: `[AI_ADDED]` — 防止 Generator 扩展 check-health.js 但未同步更新 CI workflow 的 Secrets 引用，导致 CI 跑时仍读不到新平台 cookies；同时确保 smoke 脚本覆盖输出格式验证

**可观测行为**: `.github/workflows/session-health-check.yml` 含 KUAISHOU_MAIN 等新平台的 Secret 引用（env 段）；`session-health-smoke.sh` 存在且以 exit 0 收尾；`SKIP_HTTP_CHECK=true` 模式下 check-health.js 输出 JSON 报告含 ≥ 8 条平台记录

**验证命令**:
```bash
# CI workflow 含新 Secrets
node -e "
const wf = require('fs').readFileSync('.github/workflows/session-health-check.yml', 'utf8');
const required = ['KUAISHOU_MAIN', 'XIAOHONGSHU_MAIN', 'FEISHU_BOT_WEBHOOK'];
const missing = required.filter(k => !wf.includes(k));
if (missing.length > 0) { console.error('FAIL: workflow 缺少', missing); process.exit(1); }
console.log('OK: workflow 含新 Secrets 引用');
"
# smoke 脚本存在
node -e "require('fs').accessSync('.github/workflows/scripts/smoke/session-health-smoke.sh'); console.log('OK: smoke 脚本存在')" || { echo "FAIL: session-health-smoke.sh 不存在"; exit 1; }
```

**硬阈值**: workflow 含 KUAISHOU_MAIN、XIAOHONGSHU_MAIN、FEISHU_BOT_WEBHOOK；smoke 脚本存在

---

## E2E 验收（windows_cloud — GitHub Actions windows-latest）

**journey_type**: user_facing
**target_environment**: windows_cloud

> 选模板原因：PRD 明确指定 `target_environment: windows_cloud`，ZenithJoy 产品 E2E 走 GitHub Actions windows-latest runner。OperatorPage UI 无法在无头 CI 环境中运行完整 Playwright 测试，E2E 聚焦 check-health.js 脚本行为和文件完整性验证。

```powershell
# final-e2e 验证脚本（在 GitHub Actions windows-latest runner 上执行）
# 存放路径: sprints/zj-ops1-session-health/e2e-verify.ps1

param(
  [string]$Repo = "perfectuser21/zenithjoy-workspace"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 安装依赖
Write-Host "=== Step 1: npm ci ==="
Set-Location "$PSScriptRoot\..\..\.."
npm ci --prefer-offline 2>&1 | Select-Object -Last 10
if ($LASTEXITCODE -ne 0) { throw "FAIL: npm ci 失败" }

# 2. 设置 mock 环境变量（SKIP_HTTP_CHECK 绕过真实 HTTP 调用）
Write-Host "=== Step 2: 设置 mock 环境变量 ==="
$env:SKIP_HTTP_CHECK = "true"
$env:BARK_URL = "https://api.day.app/test_disabled_e2e"
$env:FEISHU_BOT_WEBHOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/test_disabled"
# 仅配置抖音 mock cookie（其他平台未配置 → 应显示"未配置"不报错）
$env:DOUYIN_COOKIES_MAIN = '[{"name":"sessionid","value":"mock_e2e_test","domain":".douyin.com","expires":9999999999,"path":"/"}]'

# 3. 运行 check-health.js（SKIP_HTTP_CHECK 模式，不做真实 HTTP 请求）
Write-Host "=== Step 3: 运行 check-health.js ==="
$output = node scripts/sessions/check-health.js 2>&1
Write-Host ($output -join "`n")
# 脚本应 exit 0（仅 mock cookie 有效，其他未配置平台 graceful skip）

# 4. 验证 session-health-report.json 格式
Write-Host "=== Step 4: 验证健康报告格式 ==="
if (-not (Test-Path "session-health-report.json")) {
  Write-Error "FAIL: session-health-report.json 不存在"
  exit 1
}
$report = Get-Content "session-health-report.json" -Raw | ConvertFrom-Json
if (-not $report.results) {
  Write-Error "FAIL: 报告缺少 results 字段"
  exit 1
}
$platformCount = $report.results.Count
Write-Host "报告含 $platformCount 个平台记录"
if ($platformCount -lt 8) {
  Write-Error "FAIL: 报告含 $platformCount 个平台记录，期望 ≥ 8（8平台各MAIN账号）"
  exit 1
}

# 5. 验证 OperatorPage.tsx 文件完整性
Write-Host "=== Step 5: 验证 OperatorPage.tsx 存在 ==="
$opPath = "apps/dashboard/src/pages/OperatorPage.tsx"
if (-not (Test-Path $opPath)) {
  Write-Error "FAIL: OperatorPage.tsx 不存在"
  exit 1
}
$opContent = Get-Content $opPath -Raw
if (-not ($opContent -match "xuxiao21xx@icloud\.com|is_operator|isOperator")) {
  Write-Error "FAIL: OperatorPage 缺少 operator 权限判断"
  exit 1
}
Write-Host "OK: OperatorPage.tsx 含权限判断"

# 6. 验证 navigation.config.ts 注册 /operator 路由
Write-Host "=== Step 6: 验证 /operator 路由注册 ==="
$navContent = Get-Content "apps/dashboard/src/config/navigation.config.ts" -Raw
if (-not ($navContent -match "/operator")) {
  Write-Error "FAIL: navigation.config.ts 缺 /operator 路由"
  exit 1
}
Write-Host "OK: /operator 路由已注册"

Write-Host "✅ windows_cloud E2E 验证通过 platformCount=$platformCount"
exit 0
```

**PASS 标准**: 脚本 exit 0 + session-health-report.json 含 ≥ 8 平台记录 + OperatorPage.tsx 存在且含权限判断 + /operator 路由注册
**FAIL 标准**: exit 1 OR 平台数 < 8 OR 任一文件缺失 OR timeout 10min
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---

## Workstreams

workstream_count: 4

---

## Workstreams 切分（v7.7 验证）

| WS | 文件 | 预估净增行数 | 大小 |
|---|---|---|---|
| WS1 | check-health.js | ~180 行 | M |
| WS2 | sync-from-xian-rog.sh + windows-task-scheduler.xml | ~120 行 | M |
| WS3 | OperatorPage.tsx + navigation.config.ts | ~165 行 | M |
| WS4 | session-health-check.yml + session-health-smoke.sh + e2e-windows.yml | ~100 行 | S |

所有 WS ≤ 200 行且 ≤ 3 文件，满足切分硬规则。

---

### Workstream 1: check-health.js 扩展 — 8 平台 + 3 API key + 飞书双推

**范围**: 在 PLATFORMS 数组中添加 7 个新平台（快手/小红书/视频号/头条/微博/知乎/公众号）各 MAIN/SUB_1/2/3 条目；添加 3 个 API key 检查（飞书/Notion/企微）；新增 `sendFeishuAlert()` 函数；添加 `SKIP_HTTP_CHECK=true` 支持；抖音 Secret 名统一为 DOUYIN_COOKIES_MAIN
**大小**: M（~180 行净增）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/check-health.test.ts`

---

### Workstream 2: sync-from-xian-rog.sh 扩展 + windows-task-scheduler.xml 新建

**范围**: sync 脚本重构为 sync_matrix 循环（8 平台 × MAIN/SUB_1/2/3），统一命名规范；新建 `scripts/sessions/windows-task-scheduler.xml`（包含 2hr sync 任务 + 45min 视频号心跳任务 + 4hr 其他平台心跳任务）
**大小**: M（~120 行净增，2 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/sync-secrets.test.ts`

---

### Workstream 3: OperatorPage.tsx 新建 + navigation.config.ts 路由注册

**范围**: 新建 `OperatorPage.tsx`（is_operator 权限守卫 + 8平台×4账号状态矩阵 🟢🔴⚫ + 上次同步时间 + 手动触发按钮）；`navigation.config.ts` 添加 `OperatorPage` 懒加载条目和 `/operator` 路由（requireOperator 权限守卫）
**大小**: M（~165 行净增，2 文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/operator-page.test.ts`

---

### Workstream 4: CI workflow 更新 + smoke 脚本 + e2e-windows.yml

**范围**: `session-health-check.yml` 更新 env 段（36 个 Secret 引用 + FEISHU_BOT_WEBHOOK）；新建 `session-health-smoke.sh`；新建 `e2e-windows.yml`（workflow_dispatch，windows-latest，运行 e2e-verify.ps1）
**大小**: S（~100 行净增，3 文件）
**依赖**: Workstream 3 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws4/smoke-script.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/check-health.test.ts` | 平台扩展/飞书告警/SKIP_HTTP_CHECK/API key | → 4+ failures |
| WS2 | `tests/ws2/sync-secrets.test.ts` | sync_matrix/新平台Secret/XML结构 | → 4+ failures |
| WS3 | `tests/ws3/operator-page.test.ts` | 文件存在/权限判断/路由注册/UI元素 | → 4+ failures |
| WS4 | `tests/ws4/smoke-script.test.ts` | workflow-secrets/smoke脚本/e2e-windows | → 4+ failures |
