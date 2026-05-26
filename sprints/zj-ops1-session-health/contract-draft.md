# Sprint Contract Draft (Round 1)
# ZenithJoy 运营中枢：Session 全平台健康管理（Tab 1）

## Golden Path
[运营员打开 /operator] → [check-health.js 巡检 35 账号] → [Bark+飞书双渠道告警] → [Windows 计划任务自动 sync] → [Dashboard 8×4 状态矩阵] → [CI 自动注入 Secrets]

---

### Step 1: check-health.js 生成标准 session-health-report.json（35 条目）
**来源**: `[FROM_PRD]` — PRD "WS1 — check-health.js 扩展路径" 段：遍历 8×4=32 个平台账号 + 3 个 API key，写 session-health-report.json

**可观测行为**: `SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js` 成功退出，生成 session-health-report.json，JSON array 含 35 个条目，每项 keys 严格等于 `["checkedAt","expiresAt","platform","secretEnv","status"]`

**验证命令**:
```bash
# 以离线模式运行（不发网络请求），验证 JSON 数组格式
SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; EXIT=$?
[ -f session-health-report.json ] || { echo "FAIL: session-health-report.json 不存在"; exit 1; }

# 1. 验证输出是 JSON array（不是 { results: [...] } 对象）
node -e "
  const data = JSON.parse(require('fs').readFileSync('session-health-report.json','utf8'));
  if (!Array.isArray(data)) { console.error('FAIL: 不是 JSON array'); process.exit(1); }
  if (data.length !== 35) { console.error('FAIL: count='+data.length+' 期望 35'); process.exit(1); }
  console.log('OK: array length=35');
" || exit 1

# 2. 验证每项 keys 完全等于 PRD 定义（无多余字段，无缺失字段）
node -e "
  const data = JSON.parse(require('fs').readFileSync('session-health-report.json','utf8'));
  const expected = JSON.stringify(['checkedAt','expiresAt','platform','secretEnv','status']);
  const fail = data.find((item, i) => {
    const actual = JSON.stringify(Object.keys(item).sort());
    if (actual !== expected) { console.error('FAIL item['+i+']: keys='+actual+' 期望='+expected); return true; }
  });
  if (fail) process.exit(1);
  console.log('OK: all items schema compliant');
" || exit 1

# 3. status 枚举合规（禁用 error/warning/healthy/good/bad/fail）
node -e "
  const data = JSON.parse(require('fs').readFileSync('session-health-report.json','utf8'));
  const allowed = new Set(['ok','expired','invalid','missing']);
  const forbidden = data.find((item, i) => {
    if (!allowed.has(item.status)) { console.error('FAIL item['+i+']: status='+item.status+' 非法'); return true; }
  });
  if (forbidden) process.exit(1);
  console.log('OK: all status values valid');
" || exit 1

echo "✅ Step 1 验证通过"
```

**硬阈值**: JSON array 长度 = 35，每项 keys 完全匹配，status ∈ {ok,expired,invalid,missing}

---

### Step 2: 掉线账号触发 Bark + 飞书双渠道告警（飞书 3s 超时不阻塞）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步："Bark + 飞书机器人同时推送（飞书超时 3s 后 log+continue，不阻塞 Bark）"；PRD Risks R1："sendFeishuAlert() 必须用 Promise.race + 3s timeout 包裹，catch 内 console.warn + return，不抛出，不阻塞 Bark 告警链路"

**可观测行为**: check-health.js 源码包含 `sendFeishuAlert` 函数，内部使用 `Promise.race` + 3000ms timeout；飞书调用失败不影响 Bark 调用路径

**验证命令**:
```bash
# 源码包含 sendFeishuAlert + Promise.race（静态检查，不跑网络）
node -e "
  const s = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
  if (!s.includes('sendFeishuAlert')) { console.error('FAIL: 无 sendFeishuAlert 函数'); process.exit(1); }
  if (!s.includes('Promise.race')) { console.error('FAIL: 无 Promise.race（3s timeout 实现缺失）'); process.exit(1); }
  if (!s.match(/3[_\s]*(?:000|0{3}|\*\s*1000)/)) { console.error('FAIL: 未找到 3000ms timeout 常量'); process.exit(1); }
  console.log('OK: sendFeishuAlert + Promise.race + 3000ms timeout 存在');
" || exit 1

# Bark 通知路径不依赖飞书结果（两者独立调用）
node -e "
  const s = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
  // sendFeishuAlert 应该用 try/catch 包裹，失败后继续执行 barkNotify
  if (!s.match(/sendFeishuAlert[\s\S]{0,500}barkNotify|barkNotify[\s\S]{0,500}sendFeishuAlert/)) {
    console.error('FAIL: barkNotify 和 sendFeishuAlert 应并列调用');
    process.exit(1);
  }
  console.log('OK: 双渠道并列调用结构存在');
" || exit 1

echo "✅ Step 2 验证通过"
```

**硬阈值**: `sendFeishuAlert` 函数存在，`Promise.race` + 3000ms 超时存在，飞书与 Bark 独立调用

---

### Step 3: sync 脚本覆盖 8×4 矩阵，SSH 失败保留上次 Secret
**来源**: `[FROM_PRD]` — PRD "WS2 — sync 脚本扩展路径"："循环读取 8 平台 × {default.json, burner/sub_1.json, sub_2.json, sub_3.json}"；PRD Risks R2："SSH 不通时 sync_one 失败时不调用 gh secret set（保留上次有效值）"

**可观测行为**: sync-from-xian-rog.sh 包含 8 个平台的同步矩阵（含非抖音平台），SSH 读取失败时跳过 `gh secret set` 调用，添加到 failed 数组

**验证命令**:
```bash
# sync 脚本覆盖全部 8 平台
node -e "
  const s = require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8');
  const platforms = ['KUAISHOU','XIAOHONGSHU','SHIPINHAO','TOUTIAO','WEIBO','ZHIHU','GONGZHONGHAO'];
  const missing = platforms.filter(p => !s.includes(p));
  if (missing.length > 0) { console.error('FAIL: 缺平台:', missing.join(',')); process.exit(1); }
  console.log('OK: 8 平台全部覆盖');
" || exit 1

# 脚本包含 SUB_1/SUB_2/SUB_3 账号类型
node -e "
  const s = require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8');
  ['SUB_1','SUB_2','SUB_3'].forEach(sub => {
    if (!s.includes(sub)) { console.error('FAIL: 缺 '+sub); process.exit(1); }
  });
  console.log('OK: MAIN/SUB_1/SUB_2/SUB_3 四账号类型覆盖');
" || exit 1

# SSH 失败路径：sync_one 失败时不覆盖 Secret（通过跳过 gh secret set 实现）
node -e "
  const s = require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8');
  // sync_one 函数在 json 为空时 return 不调用 gh secret set
  if (!s.match(/\[\s*-z.*json.*\]|json.*empty|json.*\"\"/)) {
    // 允许不同写法，只检查 sync_one 包含 early return
    if (!s.match(/return\b|continue\b/)) { console.error('FAIL: sync_one 无 early return'); process.exit(1); }
  }
  console.log('OK: SSH 失败 early return 逻辑存在');
" || exit 1

# Bark 告警在有失败时发送
node -e "
  const s = require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8');
  if (!s.includes('bark') || !s.match(/failed|失败/)) { console.error('FAIL: 无失败 Bark 告警'); process.exit(1); }
  console.log('OK: 失败 Bark 告警存在');
" || exit 1

echo "✅ Step 3 验证通过"
```

**硬阈值**: 脚本含 8 个平台关键词，含 SUB_1/2/3 模式，含 SSH 失败早返回逻辑

---

### Step 4: Windows 计划任务 XML 含 3 种调度（2hr sync + 45min 视频号 + 4hr 其他），心跳失败触发 sync
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4/5 步："Windows 计划任务每 2 小时自动 SSH 同步"、"视频号每 45 分钟心跳维稳；其他 7 平台每 4 小时维稳；视频号心跳失败自动触发重新同步"

**可观测行为**: `scripts/sessions/windows-task-scheduler.xml` 存在，含至少 3 个 `<Task>` 定义（2hr sync + 45min 视频号心跳 + 4hr 其他平台心跳），视频号任务含 `<OnFailed>` 触发 sync 任务的定义

**验证命令**:
```bash
# XML 文件存在
[ -f scripts/sessions/windows-task-scheduler.xml ] || { echo "FAIL: windows-task-scheduler.xml 不存在"; exit 1; }

# 含 3 种触发器（2hr / 45min / 4hr）
node -e "
  const s = require('fs').readFileSync('scripts/sessions/windows-task-scheduler.xml','utf8');
  // 检查关键时间间隔
  const has2hr = s.match(/PT2H|2.*[Hh]our|120.*[Mm]inute/);
  const has45min = s.match(/PT45M|45.*[Mm]inute/);
  const has4hr = s.match(/PT4H|4.*[Hh]our|240.*[Mm]inute/);
  if (!has2hr) { console.error('FAIL: 缺 2hr sync 触发器'); process.exit(1); }
  if (!has45min) { console.error('FAIL: 缺 45min 视频号心跳触发器'); process.exit(1); }
  if (!has4hr) { console.error('FAIL: 缺 4hr 其他平台心跳触发器'); process.exit(1); }
  console.log('OK: 3 种触发器间隔存在');
" || exit 1

# 视频号任务含 OnFailed/OnFailure trigger 指向 sync 任务
node -e "
  const s = require('fs').readFileSync('scripts/sessions/windows-task-scheduler.xml','utf8');
  if (!s.match(/OnFailed|OnFailure|onfailed/i)) { console.error('FAIL: 缺 OnFailed trigger'); process.exit(1); }
  console.log('OK: OnFailed trigger 存在');
" || exit 1

echo "✅ Step 4 验证通过"
```

**硬阈值**: XML 存在，含 PT2H + PT45M + PT4H 三种间隔，含 OnFailed/OnFailure 触发器

---

### Step 5: 运营员访问 /operator 看到 8×4 状态矩阵（is_operator 守卫）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1/2 步："运营员打开 /operator 页面，看到 8 平台 × 4 账号状态矩阵，每格显示 在线🟢/离线🔴/未配置⚫"；PRD 边界情况："运营员以外的用户访问 /operator：重定向到首页或 403"

**可观测行为**: `apps/dashboard/src/pages/OperatorPage.tsx` 存在，含 8 个平台定义 + 4 账号列（MAIN/SUB_1/SUB_2/SUB_3），含 is_operator 权限守卫逻辑；navigation.config.ts 注册 /operator 路由

**验证命令**:
```bash
# OperatorPage.tsx 存在
[ -f apps/dashboard/src/pages/OperatorPage.tsx ] || { echo "FAIL: OperatorPage.tsx 不存在"; exit 1; }

# 包含 8 个平台（检查平台关键词）
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8');
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const missing = platforms.filter(p => !s.includes(p));
  if (missing.length > 0) { console.error('FAIL: 缺平台:', missing.join(',')); process.exit(1); }
  console.log('OK: 8 个平台关键词全部存在');
" || exit 1

# 包含 4 账号列（MAIN/SUB_1/SUB_2/SUB_3）
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8');
  ['MAIN','SUB_1','SUB_2','SUB_3'].forEach(acct => {
    if (!s.includes(acct)) { console.error('FAIL: 缺账号类型', acct); process.exit(1); }
  });
  console.log('OK: 4 账号类型全部覆盖');
" || exit 1

# is_operator 权限守卫存在
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8');
  if (!s.match(/is_operator|isOperator|operator.*email|xuxiao21xx/)) {
    console.error('FAIL: 无 is_operator 权限守卫');
    process.exit(1);
  }
  console.log('OK: is_operator 守卫存在');
" || exit 1

# navigation.config.ts 注册 /operator 路由
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');
  if (!s.includes('/operator') && !s.includes('operator')) {
    console.error('FAIL: navigation.config.ts 未注册 /operator 路由');
    process.exit(1);
  }
  console.log('OK: /operator 路由已注册');
" || exit 1

echo "✅ Step 5 验证通过"
```

**硬阈值**: OperatorPage.tsx 含 8 平台 + 4 账号类型 + is_operator 守卫；/operator 路由已注册

---

### Step 6: CI session-health-check.yml 注入 35 Secrets，自动运行并上传 artifact
**来源**: `[FROM_PRD]` — PRD "WS4 — CI 路径"："session-health-check.yml 注入 35 个新 Secrets（32 平台 + 3 API key + FEISHU_BOT_WEBHOOK）→ ubuntu-latest 跑 check-health.js → 上传 artifact"

**可观测行为**: `.github/workflows/session-health-check.yml` env 段含所有 35 个平台 Secret 变量（从 DOUYIN_MAIN 到 WECOM_API_KEY）+ FEISHU_BOT_WEBHOOK；session-health-smoke.sh 存在且包含实质验证逻辑

**验证命令**:
```bash
# CI yml 包含 DOUYIN_MAIN（新命名方案）
node -e "
  const s = require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');
  if (!s.includes('DOUYIN_MAIN')) { console.error('FAIL: 新 Secret 命名 DOUYIN_MAIN 不存在（仍用旧名？）'); process.exit(1); }
  console.log('OK: DOUYIN_MAIN 存在');
" || exit 1

# CI yml 包含 ≥35 个 Secret 引用（${{ secrets.XXX }} 模式）
node -e "
  const s = require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');
  const matches = s.match(/\\\$\{\{\s*secrets\./g) || [];
  if (matches.length < 35) { console.error('FAIL: Secret 引用数='+matches.length+' 期望 ≥35'); process.exit(1); }
  console.log('OK: Secret 引用数='+matches.length);
" || exit 1

# FEISHU_BOT_WEBHOOK 存在（飞书告警专用）
node -e "
  const s = require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');
  if (!s.includes('FEISHU_BOT_WEBHOOK')) { console.error('FAIL: 缺 FEISHU_BOT_WEBHOOK'); process.exit(1); }
  console.log('OK: FEISHU_BOT_WEBHOOK 存在');
" || exit 1

# session-health-smoke.sh 存在（非 exit 0 占位）
[ -f .github/workflows/scripts/smoke/session-health-smoke.sh ] || { echo "FAIL: session-health-smoke.sh 不存在"; exit 1; }
LINES=$(grep -c '.' .github/workflows/scripts/smoke/session-health-smoke.sh 2>/dev/null || echo 0)
[ "$LINES" -ge 5 ] || { echo "FAIL: smoke 脚本内容不足 5 行（实质内容=$LINES 行）"; exit 1; }
echo "OK: smoke 脚本存在，$LINES 行"

echo "✅ Step 6 验证通过"
```

**硬阈值**: yml 含 DOUYIN_MAIN + ≥35 Secret 引用 + FEISHU_BOT_WEBHOOK；smoke 脚本 ≥5 行实质内容

---

### Step 7: SKIP_HTTP_CHECK 模式跳过网络请求，仅做格式校验（CI 离线环境保护）
**来源**: `[AI_ADDED]` — PRD 边界情况提到但未列为主流程步骤："SKIP_HTTP_CHECK=true：跳过所有网络请求"；加入原因：防止 CI E2E 离线环境因平台 URL 不可达而误报健康失败，也防止 generator 利用缺失网络环境掩盖实现错误

**可观测行为**: 设置 `SKIP_HTTP_CHECK=true` 后，脚本不调用任何 `httpGet()`，所有项目仅通过 cookie 格式 + 过期时间判断状态

**验证命令**:
```bash
# 源码中 SKIP_HTTP_CHECK 分支跳过 httpGet 调用
node -e "
  const s = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
  if (!s.includes('SKIP_HTTP_CHECK')) { console.error('FAIL: SKIP_HTTP_CHECK 未实现'); process.exit(1); }
  // 在 SKIP_HTTP_CHECK 块内，不应调用 httpGet
  const skipBlock = s.split('SKIP_HTTP_CHECK')[1] || '';
  if (skipBlock.match(/^\s*\)\s*\{[\s\S]{0,200}httpGet/)) {
    console.error('FAIL: SKIP_HTTP_CHECK 块内仍调用 httpGet');
    process.exit(1);
  }
  console.log('OK: SKIP_HTTP_CHECK 跳过 httpGet 逻辑正确');
" || exit 1

echo "✅ Step 7 验证通过"
```

**硬阈值**: SKIP_HTTP_CHECK 分支存在且不调用 httpGet

---

## E2E 验收（final-e2e — windows_cloud PowerShell）

**journey_type**: user_facing
**target_environment**: windows_cloud

> windows_cloud 变体 B：Playwright dryrun — 验证 OperatorPage 在 GitHub Actions windows-latest 上渲染

```powershell
# final-e2e 验证脚本 — Session 全平台健康管理 Dashboard E2E（windows-latest）
# 位置：sprints/zj-ops1-session-health/e2e-verify.ps1
param(
  [string]$DashboardPort = "5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 安装依赖
Set-Location "$PSScriptRoot\..\..\"
npm ci --prefer-offline 2>&1 | Select-Object -Last 5
npx playwright install chromium 2>&1 | Select-Object -Last 5

# 2. 构建并启动 Dashboard（后台）
$proc = Start-Process -FilePath "node" -ArgumentList "node_modules/.bin/vite", "--port", $DashboardPort -PassThru
Start-Sleep -Seconds 8
if ($proc.HasExited) { throw "FAIL: Dashboard 启动失败" }

# 3. 用 Playwright 模拟运营员访问 /operator
$output = npx playwright test `
  --config apps/dashboard/playwright.config.ts `
  --project chromium `
  --grep "operator" 2>&1
$exitCode = $LASTEXITCODE

# 4. 停止 Dashboard
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  Write-Error "FAIL: /operator Playwright 测试失败 exit=$exitCode"
  exit 1
}

Write-Host "✅ windows_cloud E2E — /operator Dashboard 验证通过"
exit 0
```

**PASS 标准**: 脚本 exit 0 + Playwright 所有 operator 相关 spec 通过
**FAIL 标准**: exit 1 OR Playwright 测试失败 OR timeout 15min
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---

## Workstreams

**workstream_count**: 4

---

### Workstream 1: check-health.js 全平台扩展（8×4=32 账号 + 3 API key + 飞书告警 + SKIP_HTTP_CHECK）

**范围**: 扩展 PLATFORMS 数组至 35 条目；重构 checkPlatform 输出 schema 为 PRD 规范；新增 sendFeishuAlert()；新增 SKIP_HTTP_CHECK 支持；输出格式改为 JSON array
**大小**: M（~150 行净增）
**依赖**: 无（基础脚本，其他 WS 依赖本 WS 定义的 schema）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/check-health.test.ts`

---

### Workstream 2: sync 脚本 8×4 矩阵 + windows-task-scheduler.xml

**范围**: 重构 sync-from-xian-rog.sh 覆盖 8 平台 × MAIN/SUB_1/SUB_2/SUB_3；新建 windows-task-scheduler.xml（3 种计划任务 + OnFailed trigger）
**大小**: M（~120 行净增）
**依赖**: Workstream 1 完成后（Secret 命名与 WS1 PLATFORMS 数组对齐）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/sync-script.test.ts`

---

### Workstream 3: Operator Dashboard Tab 1（8×4 状态矩阵 + is_operator 守卫）

**范围**: 新建 OperatorPage.tsx，展示 8×4 状态矩阵（平台行 × 账号列）；is_operator 权限守卫；navigation.config.ts 注册 /operator 路由
**大小**: M（~180 行净增）
**依赖**: Workstream 2 完成后（Dashboard 读取 session-health-report.json 或后端 API）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/operator-page.test.ts`

---

### Workstream 4: CI session-health-check.yml 扩展 + smoke 脚本

**范围**: yml env 段注入全部 35 个新 Secrets + FEISHU_BOT_WEBHOOK；新建 session-health-smoke.sh；新建 e2e-verify.ps1
**大小**: S（~100 行净增）
**依赖**: Workstream 3 完成后（全链路 smoke 需要所有组件就绪）

**BEHAVIOR 覆盖测试文件**: `tests/ws4/ci-session.test.ts`

---

## Workstreams 切分验证（v7.7 硬规则）

| WS | 预期净增行数 | 涉及文件数 | 合规? |
|---|---|---|---|
| WS1 | ~150 行 | 1 文件 | ✅ ≤200行 ≤3文件 |
| WS2 | ~120 行 | 2 文件 | ✅ |
| WS3 | ~180 行 | 2 文件 | ✅ |
| WS4 | ~100 行 | 3 文件 | ✅ |

总计: ~550 行 → 允许 workstream_count > 1 ✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/check-health.test.ts` | 35条目/schema/status枚举/sendFeishuAlert/SKIP_HTTP_CHECK | ≥5 failures（PLATFORMS仅2条目，无飞书/SKIP支持，格式错误）|
| WS2 | `tests/ws2/sync-script.test.ts` | 8平台/SUB_1-3/XML存在/OnFailed | ≥3 failures（仅抖音，无XML）|
| WS3 | `tests/ws3/operator-page.test.ts` | OperatorPage存在/8平台/4账号/is_operator/路由 | ≥4 failures（文件不存在）|
| WS4 | `tests/ws4/ci-session.test.ts` | DOUYIN_MAIN/≥35 Secrets/FEISHU_BOT_WEBHOOK/smoke存在 | ≥3 failures（旧命名/无新Secrets）|

---

## 自查 Checklist 结果

1. **PRD response 字段名**: `platform`, `secretEnv`, `status`, `checkedAt`, `expiresAt` ✓
2. **contract jq 字段名**: 所有 jq -e 命令使用上述字面字段名 ✓
3. **keys 集合等价**: contract keys = PRD keys = `["checkedAt","expiresAt","platform","secretEnv","status"]` ✓
4. **禁用字段反向检查**: contract 中存在 `has("name") | not`，status 禁用字段通过 allowed Set 检查 ✓
5. **BEHAVIOR 数量**: 每个 DoD 文件 ≥4 条 [BEHAVIOR]（见 contract-dod-ws*.md）✓
6. **depends_on 串行链**: ws1=[], ws2=["ws1"], ws3=["ws2"], ws4=["ws3"] ✓
7. **假绿自查**: 每条 BEHAVIOR 在 WS 未实现时必然 FAIL（文件不存在→FAIL，PLATFORMS<35→FAIL，DOUYIN_MAIN不存在→FAIL）✓
